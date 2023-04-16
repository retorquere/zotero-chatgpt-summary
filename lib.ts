declare const Cu: any
declare var Zotero: any // eslint-disable-line no-var

import { flash } from './flash'
import { Deferred } from './deferred'

if (Zotero.platformMajorVersion < 102) {
  Cu.importGlobalProperties(['fetch'])
}

type Throttle = Deferred<void>

Zotero.ChatGPTSummary = new class {
  private queue: Throttle[] = []
  private prefix = 'ChatGPT summary:'
  private jobs: WeakMap<Throttle, number> = new WeakMap
  private lastJob = 0

  constructor() {
    Zotero.getMainWindow().setInterval(() => {
      const deferred = this.queue.shift()
      if (deferred) {
        this.log(`${(new Date).toISOString()} starting ${this.jobs.get(deferred)}`)
        this.jobs.delete(deferred)
        deferred.resolve()
      }
    }, (Zotero.Prefs.get('chatgpt-summary.throttle') || 20) * 1000) // chatGPT rate-limited to 3 / min
  }

  throttle(): Promise<void> {
    const deferred = new Deferred<void>()
    this.jobs.set(deferred, ++this.lastJob)
    this.log(`${(new Date).toISOString()} scheduling ${this.jobs.get(deferred)}`)
    this.queue.push(deferred)
    return deferred.promise
  }

  log(msg) {
    Zotero.debug(`ChatGPT summary: ${msg}`)
  }

  async notes(item): Promise<string[]> {
    const ids = item.getNotes()
    if (!ids.length) return []
    return (await Zotero.Items.getAsync(ids)).map(note => note.getNote()) // eslint-disable-line @typescript-eslint/no-unsafe-return
  }

  async summarizeSelected() {
    if (!Zotero.Prefs.get('chatgpt-summary.api-key')) {
      flash('ChatGPT: no API key provided')
      return
    }

    await Zotero.initializationPromise

    const queue = Zotero
      .getActiveZoteroPane()
      .getSelectedItems()
      .filter(item => !item.isFeedItem && item.isRegularItem()) // eslint-disable-line @typescript-eslint/no-unsafe-return

    const state = {
      done: 0,
      errors: 0,
    }

    const progressWin = new Zotero.ProgressWindow({ closeOnClick: false })
    progressWin.changeHeadline('ChatGPT: summarizing')
    const progress = new progressWin.ItemProgress(`chrome://zotero/skin/treesource-unfiled${Zotero.hiDPI ? '@2x' : ''}.png`, `Summarizing: ${state.done}/${queue.length}...`)
    progressWin.show()

    this.log(`waiting for ${queue.length} requests`)
    await Promise.all(queue
      .map(async item => {
        try {
          await this.summarize(item)
        }
        catch (err) {
          state.errors++
          const error: string = err.message || `${err}`
          flash('ChatGPT summarize', error)
          this.log(`summarize error: ${error}`)
        }

        state.done++

        let errors = ''
        switch (state.errors) {
          case 0:
            break
          case 1:
            errors = ', 1 error'
            break
          default:
            errors = `, ${state.errors} errors`
            break
        }

        progress.setText(`Summarizing: ${state.done}/${queue.length}${errors}...`)
      })
    )
    this.log('all done')

    progressWin.startCloseTimer(10)
  }

  async summarize(item: any) {
    if (item.isFeedItem || !item.isRegularItem()) return
    if ((await this.notes(item)).find(note => note.includes(this.prefix))) return

    await this.throttle()

    const prompt: string = Zotero.Prefs.get('chatgpt-summary.prompt').replace(/{{([^}]+)}}/g, (match, field) => item.getField(field) as string)
    this.log(`prompt: ${prompt}`)
    const response = await (await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Zotero.Prefs.get('chatgpt-summary.api-key')}`,
      },
      body: JSON.stringify({
        model: Zotero.Prefs.get('chatgpt-summary.model'),
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
    })).json()

    const error: string = response?.error?.message
    if (error) {
      this.log(`summarize denied: ${error}`)
      throw new Error(error)
    }

    const message = response?.choices?.[0]?.message?.content
    if (message) {
      this.log(`response: ${message}`)
      const note = new Zotero.Item('note')
      note.libraryID = item.libraryID
      note.setNote(`<p>${this.prefix}</p>${message}`)
      note.parentKey = item.key
      await note.saveTx()
    }
    else {
      this.log(`no response for ${prompt} (${JSON.stringify(response)})`)
    }
  }
}

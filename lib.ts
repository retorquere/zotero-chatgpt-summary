declare const Cu: any
declare var Zotero: any // eslint-disable-line no-var

Zotero.debug('summarize: inner loading')

import { flash } from './flash'
import { Deferred } from './deferred'

if (Zotero.platformMajorVersion < 102) {
  Cu.importGlobalProperties(['fetch'])
}

Zotero.ChatGPTSummary = new class {
  queue: Deferred<void>[] = []
  prefix = 'ChatGPT summary:'

  constructor() {
    Zotero.debug('summarize: inner constructor')
    Zotero.getMainWindow().setInterval(() => {
      if (this.queue.length) this.queue.shift().resolve()
    }, 3000) // chatGPT rate-limited to 20 / min
  }

  throttle(): Promise<void> {
    const deferred = new Deferred<void>()
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

  async summarizeAll(items: any[]) {
    if (!Zotero.Prefs.get('chatgpt-summary.api-key')) {
      flash('ChatGPT: no API key provided')
      return
    }

    await Zotero.initializationPromise

    const queue = items.map(async item => this.summarize(item))

    const state = {
      done: 0,
      errors: 0,
      last: '',
    }

    const progressWin = new Zotero.ProgressWindow({ closeOnClick: false })
    progressWin.changeHeadline('ChatGPT: summarizing')
    // progressWin.addDescription(`Found ${this.scanning.length} items without a citation key`)
    const progress = new progressWin.ItemProgress(`chrome://zotero/skin/treesource-unfiled${Zotero.hiDPI ? '@2x' : ''}.png`, `Summarizing: ${state.done}/${items.length}...`)
    progressWin.show()

    function done(error='') { // eslint-disable-line prefer-arrow/prefer-arrow-functions
      state.done++
      if (error) {
        state.errors++
        Zotero.debug(`summarize error: ${error}`)
        state.last = error
      }
      const errors = state.errors ? `, ${state.errors} errors, last error: ${state.last}` : ''
      progress.setText(`Summarizing: ${state.done}/${items.length}${errors}...`)
    }
    for (const summarized of queue) {
      summarized
        .then(() => { done() })
        .catch((err: Error) => { done(err.message || `${err}`) })
    }
    await Promise.all(queue)
    progressWin.startCloseTimer(10) // eslint-disable-line 
  }

  async summarize(item: any) {
    if (item.isFeedItem || !item.isRegularItem()) return
    if ((await this.notes(item)).find(note => note.includes(this.prefix))) return

    await this.throttle()

    const prompt: string = Zotero.Prefs.get('chatgpt-summary.prompt').replace(/{{([^}]+)}}/g, (match, field) => item.getField(field) as string)
    Zotero.debug(`summarize prompt: ${prompt}`)
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
    Zotero.debug(`summarize error: ${error}`)
    if (error) throw new Error(error)

    const message = response?.choices?.[0]?.message?.content
    if (message) {
      Zotero.debug(`summarize response: ${message}`)
      const note = new Zotero.Item('note')
      note.libraryID = item.libraryID
      note.setNote(`${this.prefix}${message}`)
      note.parentKey = item.key
      await note.saveTx()
    }
    else {
      Zotero.debug(`summarize error: no response for ${prompt} (${JSON.stringify(response)})`)
    }
  }
}

Zotero.debug('summarize: inner loaded and assigned')

const seconds = 1000

declare const Zotero: any

export function flash(title: string, body?: string, timeout = 8): void {
  try {
    Zotero.debug(`flash: ${JSON.stringify({title, body})}`)
    const pw = new Zotero.ProgressWindow()
    pw.changeHeadline(`ChatGPT Summary: ${title}`)
    if (!body) body = title
    if (Array.isArray(body)) body = body.join('\n')
    pw.addDescription(body)
    pw.show()
    pw.startCloseTimer(timeout * seconds)
  }
  catch (err) {
    Zotero.debug(`@flash failed: ${JSON.stringify({title, body, err})}`)
  }
}

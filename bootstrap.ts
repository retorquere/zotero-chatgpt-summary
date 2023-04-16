/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/ban-types, prefer-rest-params, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-unsafe-return */

const stylesheetID = 'zotero-chatgpt-summary-stylesheet'
const ftlID = 'zotero-chatgpt-summary-ftl'
const menuitemID = 'make-it-green-instead'
const addedElementIDs = [stylesheetID, ftlID, menuitemID]

import { patch as $patch$ } from './monkey-patch'

declare var Zotero: any // eslint-disable-line no-var
declare const ChromeUtils: any
declare const Ci: any
declare const dump: (msg: string) => void

function log(msg) {
  Zotero.debug(`ChatGPT summary: ${msg}`)
}

// In Zotero 6, bootstrap methods are called before Zotero is initialized, and using include.js
// to get the Zotero XPCOM service would risk breaking Zotero startup. Instead, wait for the main
// Zotero window to open and get the Zotero object from there.
//
// In Zotero 7, bootstrap methods are not called until Zotero is initialized, and the 'Zotero' is
// automatically made available.
async function waitForZotero() {
  if (typeof Zotero != 'undefined') {
    await Zotero.initializationPromise
    return
  }

  if (typeof Services == 'undefined') {
    var { Services } = ChromeUtils.import('resource://gre/modules/Services.jsm') // eslint-disable-line no-var
  }
  const windows = Services.wm.getEnumerator('navigator:browser')
  let found = false
  while (windows.hasMoreElements()) {
    const win = windows.getNext()
    if (win.Zotero) {
      Zotero = win.Zotero
      found = true
      break
    }
  }
  if (!found) {
    await new Promise(resolve => {
      const listener = {
        onOpenWindow: aWindow => {
          // Wait for the window to finish loading
          const domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow)
          domWindow.addEventListener('load', () => {
            domWindow.removeEventListener('load', arguments.callee, false) // eslint-disable-line no-caller
            if (domWindow.Zotero) {
              Services.wm.removeListener(listener)
              Zotero = domWindow.Zotero
              resolve(undefined)
            }
          }, false)
        },
      }
      Services.wm.addListener(listener)
    })
  }
  await Zotero.initializationPromise
}


// Loads default preferences from prefs.js in Zotero 6
function setDefaultPrefs(rootURI) {
  if (typeof Services == 'undefined') {
    var { Services } = ChromeUtils.import('resource://gre/modules/Services.jsm') // eslint-disable-line no-var
  }
  const branch = Services.prefs.getDefaultBranch('')
  const obj = {
    pref: (pref, value) => {
      switch (typeof value) {
        case 'boolean':
          branch.setBoolPref(pref, value)
          break
        case 'string':
          branch.setStringPref(pref, value)
          break
        case 'number':
          branch.setIntPref(pref, value)
          break
        default:
          Zotero.logError(`Invalid type '${typeof(value)}' for pref '${pref}'`)
      }
    },
  }
  Services.scriptloader.loadSubScript(`${rootURI}prefs.js`, obj)
}


export async function install() {
  await waitForZotero()

  log('Installed')
}

// async function startup({ id, version, resourceURI, rootURI = resourceURI.spec }) {
export async function startup({ resourceURI, rootURI = resourceURI.spec }) {
  await waitForZotero()

  log('Starting')

  // 'Services' may not be available in Zotero 6
  if (typeof Services == 'undefined') {
    var { Services } = ChromeUtils.import('resource://gre/modules/Services.jsm') // eslint-disable-line no-var
  }

  // Read prefs from prefs.js when the plugin in Zotero 6
  if (Zotero.platformMajorVersion < 102) {
    setDefaultPrefs(rootURI)
  }

  // Add DOM elements to the main Zotero pane
  const win = Zotero.getMainWindow()
  if (win && win.ZoteroPane) {
    const zp = win.ZoteroPane
    const doc = win.document
    const id = 'zotero-itemmenu-chatgpt-summary'

    $patch$(zp, 'buildItemContextMenu', original => async function buildItemContextMenu() {
      await original.apply(this, arguments)

      const items = this.getSelectedItems().filter(item => !item.isFeedItem && item.isRegularItem()) // eslint-disable-line @typescript-eslint/no-unsafe-return
      let menuitem = doc.getElementById(id)
      if (!menuitem) {
        const menu = doc.getElementById('zotero-itemmenu')

        const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'
        menuitem = doc.createElementNS(XUL_NS, 'menuitem')
        menuitem.setAttribute('label', 'Summarize')
        menuitem.setAttribute('tooltiptext', '')
        menuitem.id = id
        menuitem.addEventListener('command', () => { Zotero.ChatGPTSummary.summarizeSelected() })

        menu.appendChild(menuitem)
      }

      menuitem.hidden = !items.length
    })
  }

  Zotero.debug('summarize: loading')
  Services.scriptloader.loadSubScript(`${rootURI}lib.js`)
  Zotero.debug('summarize: loaded')
}

export function shutdown() {
  log('Shutting down')

  // Remove stylesheet
  const zp = Zotero.getActiveZoteroPane()
  if (zp) {
    for (const id of addedElementIDs) {
      const elem = zp.document.getElementById(id)
      if (elem) elem.remove()
    }
  }
}

export function uninstall() {
  // `Zotero` object isn't available in `uninstall()` in Zotero 6, so log manually
  if (typeof Zotero == 'undefined') {
    dump('ChatGPT summary: Uninstalled\n\n')
    return
  }

  log('Uninstalled')
}

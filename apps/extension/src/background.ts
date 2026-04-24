// apps/extension/src/background.ts

import {
  ExternalMessageSchema,
  type InvokeMessage,
  InvokeMessageSchema,
  type PageOperation,
} from './lib/messaging'

/**
 * MV3 service worker.
 *
 * Responsibilities:
 *   1. On toolbar icon click → toggle the in-page Auxx panel.
 *   2. Bridge iframe `{type: 'invoke'}` messages to the active tab.
 *   3. Respond to the auxx.ai web app's `{type: 'version'}` ping so the
 *      "Get the extension" CTA can detect the extension is installed.
 *
 * Session state is not tracked here — the iframe asks auxx.ai directly via
 * `/api/extension/session` using a credentialed CORS fetch (see
 * `src/iframe/trpc.ts`).
 */

const MANIFEST_VERSION =
  (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) ?? '0.0.0'

/**
 * URLs that Chrome blocks extension scripts from touching: the built-in
 * `chrome://*` pages, the Web Store, file://, the new-tab page, etc. If we
 * try to `executeScript` on one of these the call throws loudly, so we
 * filter early and give the user a quiet no-op instead.
 */
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('chrome://')) return false
  if (url.startsWith('chrome-extension://')) return false
  if (url.startsWith('edge://')) return false
  if (url.startsWith('about:')) return false
  if (url.startsWith('chrome-search://')) return false
  if (url.startsWith('chrome-untrusted://')) return false
  if (url.startsWith('devtools://')) return false
  if (url.startsWith('view-source:')) return false
  if (url.includes('chrome.google.com/webstore')) return false
  if (url.includes('chromewebstore.google.com')) return false
  return true
}

// ─── Utility: invoke a page operation in a tab ─────────────────
async function invokeOnTab(tabId: number, operation: PageOperation, args: unknown[] = []) {
  await ensureInjected(tabId)
  if (!injectedTabs.has(tabId)) return null
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (op: string, payload: unknown[]) => {
        // biome-ignore lint/suspicious/noExplicitAny: cross-world bridge
        const dispatcher = (window as any).__auxx__
        if (typeof dispatcher === 'function') {
          return dispatcher(op, ...payload)
        }
        return null
      },
      args: [operation, args],
    })
    return result?.result ?? null
  } catch (err) {
    console.warn('[auxx] invoke failed', err)
    return null
  }
}

const injectedTabs = new Set<number>()

async function ensureInjected(tabId: number) {
  if (injectedTabs.has(tabId)) return
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab || !isInjectableUrl(tab.url)) return
  const frameUrl = chrome.runtime.getURL('src/iframe/index.html')
  try {
    // Inline inject into the page MAIN world. We used to ship `src/inject.ts`
    // as a separate file and load it via `executeScript({files: [...]})`, but
    // that requires the file to be served as a static asset — which breaks
    // in Vite dev (ts not directly loadable by Chrome) and is unnecessary
    // indirection in prod. The body below is the previous inject.ts.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [frameUrl],
      func: (url: string) => {
        // biome-ignore lint/suspicious/noExplicitAny: cross-world bridge
        const w = window as any
        if (w.__AUXX_INJECTED) return
        w.__AUXX_INJECTED = true
        w.__AUXX_FRAME_URL__ = url
        document.documentElement.dataset.auxxFrameUrl = url

        const FRAME_ID = 'auxx-panel'
        const STYLE_ID = 'auxx-panel-style'

        function ensureStyles() {
          if (document.getElementById(STYLE_ID)) return
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = `
            #${FRAME_ID} {
              position: fixed;
              top: 0;
              right: 0;
              width: 420px;
              height: 100vh;
              border: 0;
              border-left: 1px solid rgba(0,0,0,0.08);
              box-shadow: -8px 0 32px rgba(0,0,0,0.08);
              background: white;
              z-index: 2147483646;
              transform: translateX(100%);
              transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
              color-scheme: light dark;
            }
            #${FRAME_ID}[data-visible="true"] { transform: translateX(0); }
            @media (prefers-color-scheme: dark) {
              #${FRAME_ID} {
                background: #0b0b0c;
                border-left-color: rgba(255,255,255,0.08);
              }
            }
          `
          document.head.appendChild(style)
        }

        // Desired visibility persists in sessionStorage so it survives full
        // page reloads on the same origin (e.g. LinkedIn profile→profile).
        // Without this, every navigation would re-inject with the default
        // hidden state and close the user's open panel.
        const VISIBILITY_KEY = 'auxx-panel-visible'
        let desiredVisible = false
        try {
          desiredVisible = sessionStorage.getItem(VISIBILITY_KEY) === 'true'
        } catch {
          /* sessionStorage blocked — default hidden */
        }

        function ensureFrame(): HTMLIFrameElement {
          let frame = document.getElementById(FRAME_ID) as HTMLIFrameElement | null
          if (frame) return frame
          ensureStyles()
          frame = document.createElement('iframe')
          frame.id = FRAME_ID
          frame.src = url
          frame.setAttribute('data-visible', desiredVisible ? 'true' : 'false')
          document.body.appendChild(frame)
          return frame
        }

        function setVisible(visible: boolean) {
          desiredVisible = visible
          try {
            sessionStorage.setItem(VISIBILITY_KEY, visible ? 'true' : 'false')
          } catch {
            /* ignore */
          }
          const frame = ensureFrame()
          frame.setAttribute('data-visible', visible ? 'true' : 'false')
        }

        function isVisible(): boolean {
          return desiredVisible
        }

        // LinkedIn (and some other SPAs) will occasionally wipe our iframe
        // from document.body when they re-render around navigation. Watch
        // for it and re-append — React inside the iframe will re-mount and
        // re-boot from the freshly loaded src.
        function guardAgainstRemoval() {
          const observer = new MutationObserver(() => {
            if (!document.getElementById(FRAME_ID)) ensureFrame()
          })
          observer.observe(document.body, { childList: true })
        }
        guardAgainstRemoval()

        function dispatchToContentScript(op: string, payload: unknown[]): Promise<unknown> {
          return new Promise((resolve) => {
            const requestId = `${op}:${Date.now()}:${Math.random().toString(36).slice(2)}`
            const handler = (event: MessageEvent) => {
              if (event.source !== window) return
              const data = event.data as
                | { source?: string; op?: string; requestId?: string; value?: unknown }
                | undefined
              if (data?.source !== 'auxx-page-result') return
              if (data.requestId !== requestId) return
              window.removeEventListener('message', handler)
              resolve(data.value)
            }
            window.addEventListener('message', handler)
            window.postMessage(
              { source: 'auxx-page', op, args: payload, requestId },
              window.location.origin
            )
            setTimeout(() => {
              window.removeEventListener('message', handler)
              resolve(null)
            }, 8000)
          })
        }

        w.__auxx__ = (operation: string, ...args: unknown[]) => {
          switch (operation) {
            case 'showFrame':
              setVisible(true)
              return true
            case 'hideFrame':
              setVisible(false)
              return true
            case 'toggleFrame':
              setVisible(!isVisible())
              return true
            case 'prewarm':
              // Ensure the iframe exists at the visibility we last had on
              // this origin. No-op if already injected + matching state.
              ensureFrame()
              return true
            case 'parseGmail':
            case 'parseLinkedIn':
            case 'parseLinkedInCompany':
            case 'parseSalesNavigator':
              return dispatchToContentScript(operation, args)
            default:
              return null
          }
        }
      },
    })
    injectedTabs.add(tabId)
  } catch (err) {
    // Permissions may be missing for this tab — silently skip.
    console.warn('[auxx] inject failed', err)
  }
}

// Drop tabs from the injected set when they navigate away or close.
chrome.tabs.onRemoved.addListener((tabId) => injectedTabs.delete(tabId))
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') injectedTabs.delete(tabId)
  if (info.url) {
    // SPA-style URL change (pushState) — tell the iframe so it can
    // re-parse the new page. Full reloads also fire this but the fresh
    // iframe mount already re-boots, so the duplicate signal is harmless.
    chrome.runtime.sendMessage({ type: 'tabNavigated', tabId, url: info.url }).catch(() => {
      /* no iframe listener yet — harmless */
    })
  }
})

// ─── Toolbar icon click → toggle panel ─────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  await invokeOnTab(tab.id, 'toggleFrame')
})

// ─── Iframe → SW: invoke a page op ─────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const parsed = InvokeMessageSchema.safeParse(message)
  if (!parsed.success) return false

  const tabId = sender.tab?.id
  if (!tabId) {
    sendResponse({ ok: false, error: 'no-tab' })
    return true
  }

  handleInvoke(tabId, parsed.data)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    )

  return true // keep the message channel open for the async response
})

async function handleInvoke(tabId: number, msg: InvokeMessage) {
  const value = await invokeOnTab(tabId, msg.operation, msg.args ?? [])
  // Any panel-open signal → tell the iframe to re-parse against the current
  // tab. Fire-and-forget; `chrome.runtime.sendMessage` to no listener logs a
  // benign warning we swallow.
  if (msg.operation === 'showFrame' || msg.operation === 'toggleFrame') {
    chrome.runtime.sendMessage({ type: 'panelOpened', tabId }).catch(() => {
      /* no listener yet — iframe boots on its own */
    })
  }
  return value
}

// ─── External (auxx.ai) → SW ───────────────────────────────────
// Only `version` is kept. The web app uses this to detect whether the
// extension is installed (for the "Get the extension" CTA copy).
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  const parsed = ExternalMessageSchema.safeParse(message)
  if (!parsed.success) {
    sendResponse({ ok: false, error: 'invalid-shape' })
    return false
  }

  if (parsed.data.type === 'version') {
    sendResponse({ type: 'version', payload: MANIFEST_VERSION })
  }
  return false
})

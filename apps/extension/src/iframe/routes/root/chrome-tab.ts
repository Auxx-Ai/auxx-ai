// apps/extension/src/iframe/routes/root/chrome-tab.ts

import type { PageOperation } from '../../../lib/messaging'

/**
 * Chrome-extension plumbing: read the iframe's *own* tab (not the focused
 * one) and dispatch a parse op to the page via the SW relay. Splitting
 * these out from the orchestrator keeps the route file focused on the
 * state machine.
 */

/**
 * The iframe's own tab id, written into `iframe.src` as `?tabId=N` by the
 * MAIN-world inject script (see `background.ts`). Captured at module load
 * because window.location is fixed for the iframe's lifetime.
 *
 * Reading the iframe's *own* tab — instead of `chrome.tabs.query({active})`
 * — is what keeps a background-tab iframe from re-rendering with the
 * focused tab's URL when something else triggers a re-boot.
 */
export const OWN_TAB_ID: number | null = (() => {
  const raw = new URLSearchParams(window.location.search).get('tabId')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
})()

export async function readOwnTab(): Promise<chrome.tabs.Tab | null> {
  if (OWN_TAB_ID === null) {
    // Fallback for older injected frames (no tabId param) — preserves the
    // prior behaviour. Should be unreachable in practice once users reload.
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return tab ?? null
    } catch {
      return null
    }
  }
  try {
    return await chrome.tabs.get(OWN_TAB_ID)
  } catch {
    return null
  }
}

export async function invokeOnPage<T = unknown>(operation: PageOperation): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'invoke', operation, args: [] }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      if (!response?.ok) {
        resolve(null)
        return
      }
      resolve((response.value as T) ?? null)
    })
  })
}

// apps/extension/src/content/_shared.ts

import { observeDocumentBody } from '../lib/dom'
import type { PageOperation } from '../lib/messaging'
import type { ParseResult } from '../lib/parsers/types'

/**
 * Common boilerplate every content script uses:
 *   - listens for parse-op messages from inject.ts (via window.postMessage)
 *   - injects an "Add to Auxx" button next to the host site's native action
 *     bar, re-injecting on SPA mutations
 *   - pings `extension.parserHealth` once per load so we can monitor parser
 *     breakage in aggregate
 */

const EXTENSION_VERSION =
  (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) ?? '0.0.0'

export type ParseOpKey = Extract<
  PageOperation,
  'parseGmail' | 'parseLinkedIn' | 'parseLinkedInCompany' | 'parseSalesNavigator'
>

export type ContentScriptConfig = {
  host: 'gmail' | 'linkedin' | 'sales-navigator'
  /**
   * Map of parse-op → parser. The host receives any op in this map; ops not
   * listed are silently ignored (the SW forwards to every content script).
   */
  parsers: Partial<Record<ParseOpKey, () => Promise<ParseResult>>>
  /** Mounts the "Add to Auxx" button. Should be idempotent. */
  ensureButton: () => void
}

export function setupContentScript(config: ContentScriptConfig): void {
  // 1. parse-op listener (inject.ts → us via window.postMessage)
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as
      | { source?: string; op?: string; requestId?: string; args?: unknown[] }
      | undefined
    if (data?.source !== 'auxx-page') return
    const op = data.op as ParseOpKey | undefined
    if (!op) return
    const parser = config.parsers[op]
    if (!parser) return

    let value: ParseResult | null = null
    try {
      value = await parser()
    } catch (err) {
      console.warn(`[auxx] ${config.host} parse failed for ${op}`, err)
    }
    window.postMessage(
      {
        source: 'auxx-page-result',
        op: data.op,
        requestId: data.requestId,
        value,
      },
      window.location.origin
    )
  })

  // 2. inject the button on initial load + every SPA mutation
  observeDocumentBody(() => {
    try {
      config.ensureButton()
    } catch (err) {
      console.warn(`[auxx] ${config.host} button mount failed`, err)
    }
  })

  // 3. fire the parser-health ping once
  void pingParserHealth(config.host)

  // 4. pre-warm the iframe. `prewarm` triggers the SW's `ensureInjected`
  //    path without touching visibility — crucial so that navigating
  //    between LinkedIn profiles (which does a full page reload) doesn't
  //    close an already-open panel. The injected script restores its
  //    desired visibility from sessionStorage at init time.
  try {
    chrome.runtime.sendMessage({ type: 'invoke', operation: 'prewarm', args: [] })
  } catch {
    /* extension may not be ready yet — content script observers re-fire later */
  }
}

const AUXX_BUTTON_ID_PREFIX = 'auxx-add-button'

/**
 * Build a button matching the host site's native action styling. Returns
 * the same node on subsequent calls within the same mount point so the
 * MutationObserver doesn't keep stacking copies.
 */
export function buildAuxxButton(opts: {
  host: ContentScriptConfig['host']
  label?: string
  onClick: () => void
}): HTMLButtonElement {
  const id = `${AUXX_BUTTON_ID_PREFIX}-${opts.host}`
  const existing = document.getElementById(id) as HTMLButtonElement | null
  if (existing) return existing

  const btn = document.createElement('button')
  btn.id = id
  btn.type = 'button'
  btn.textContent = opts.label ?? 'Add to Auxx'
  btn.style.cssText = [
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
    'margin-left: 8px',
    'padding: 6px 12px',
    'border: 1px solid currentColor',
    'border-radius: 999px',
    'background: transparent',
    'color: inherit',
    'font: inherit',
    'font-size: 13px',
    'cursor: pointer',
  ].join(';')
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onClick()
  })
  return btn
}

export function openPanel(): void {
  chrome.runtime.sendMessage({ type: 'invoke', operation: 'showFrame', args: [] })
}

async function pingParserHealth(host: string): Promise<void> {
  try {
    // We don't have direct DB access from the content script; we route
    // through the iframe's tRPC client, which runs against auxx.ai. To keep
    // the content script independent of the iframe lifecycle, we emit a
    // chrome.runtime broadcast that the iframe can listen for if it's open.
    // The actual call lands in iframe/app.tsx on first mount, picking up
    // the latest host so we still get the data.
    void chrome.storage.local.set({
      lastParserHealthPing: {
        host,
        url: location.href,
        version: EXTENSION_VERSION,
        ts: Date.now(),
      },
    })
  } catch (err) {
    console.warn('[auxx] parser-health ping failed', err)
  }
}

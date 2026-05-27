// packages/chat/src/client/index.ts

/**
 * Browser bootstrap for `@auxx/chat`.
 *
 * Wraps the widget bundle that ships in `./widget-bundle` so customers can
 * install via npm instead of pasting a `<script data-channel-id>` snippet:
 *
 *     import Auxx from '@auxx/chat'
 *     Auxx.boot({ channelId: 'abc', userJwt, attributes: {...} })
 *     Auxx.update({ plan: 'pro' })
 *     Auxx.shutdown()
 *
 * Defaults to the hosted bundle at `app.auxx.ai/scripts/chat-widget.js`.
 * Customers self-hosting can pass `widgetBase` (or set `AUXX_WIDGET_URL` at
 * build time). `apiBase` is propagated to the bundle via
 * `window.__AUXX_CONFIG__` *before* the script tag is injected, so the same
 * override chain applies whether the bundle came from our CDN or from
 * `node_modules`.
 *
 * `userJwt` is accepted here but only stored on the bootstrap state — phase 3
 * wires it through the actual transport layer.
 */

import { API_URL, WIDGET_URL } from '../shared/env'

export interface BootOptions {
  channelId: string
  userJwt?: string
  attributes?: Record<string, unknown>
  apiBase?: string
  widgetBase?: string
  theme?: 'light' | 'dark' | 'system'
}

interface BootState {
  channelId: string
  apiBase: string
  widgetBase: string
  userJwt?: string
  attributes?: Record<string, unknown>
  scriptTag?: HTMLScriptElement
  containerSelector?: string
}

declare global {
  interface Window {
    AuxxChat?: unknown
  }
}

let state: BootState | null = null

function ensureBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('@auxx/chat: boot() can only run in a browser environment')
  }
}

function pushAttributes(attributes: Record<string, unknown>): void {
  if (!Object.keys(attributes).length) return
  const queue = (window.AuxxChat ??= [] as unknown[])
  if (Array.isArray(queue)) {
    queue.push(['identify', attributes])
  } else {
    const handle = queue as { push?: (cmd: unknown) => void }
    handle.push?.(['identify', attributes])
  }

  // Mirror onto __AUXX_CONFIG__ so `buildUserDataEnvelope()` can ship the
  // non-sensitive bag alongside the JWT for phase-4 resolution.
  const cfg = (window.__AUXX_CONFIG__ ??= {})
  cfg.attributes = { ...(cfg.attributes ?? {}), ...attributes }
}

function boot(options: BootOptions): void {
  ensureBrowser()
  if (state) {
    // Same-channel re-boot is a soft refresh: we don't re-inject the script,
    // but we do roll forward the userJwt (so the React wrapper's reboot-on-
    // JWT-change effect actually rotates the token) and push any new
    // attributes through the identify queue.
    if (state.channelId === options.channelId) {
      if (options.userJwt !== undefined) {
        state.userJwt = options.userJwt
        const cfg = (window.__AUXX_CONFIG__ ??= {})
        if (options.userJwt) cfg.userJwt = options.userJwt
        else delete cfg.userJwt
      }
      if (options.attributes) pushAttributes(options.attributes)
      return
    }
    shutdown()
  }

  const apiBase = options.apiBase ?? API_URL
  const widgetBase = options.widgetBase ?? WIDGET_URL

  window.__AUXX_CONFIG__ = {
    ...(window.__AUXX_CONFIG__ ?? {}),
    apiBase,
    ...(options.userJwt ? { userJwt: options.userJwt } : {}),
  }

  if (options.attributes) pushAttributes(options.attributes)

  const next: BootState = {
    channelId: options.channelId,
    apiBase,
    widgetBase,
    userJwt: options.userJwt,
    attributes: options.attributes,
  }

  // Reuse an already-loaded bundle if present.
  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-auxx-chat][data-channel-id="${options.channelId}"]`
  )
  if (existing) {
    next.scriptTag = existing
    state = next
    return
  }

  const tag = document.createElement('script')
  tag.async = true
  tag.dataset.auxxChat = 'true'
  tag.dataset.channelId = options.channelId
  if (options.theme) tag.dataset.theme = options.theme
  tag.src = widgetBase
  document.head.appendChild(tag)
  next.scriptTag = tag
  state = next
}

function update(attributes: Record<string, unknown>): void {
  ensureBrowser()
  if (!state) {
    throw new Error('@auxx/chat: update() called before boot()')
  }
  state.attributes = { ...(state.attributes ?? {}), ...attributes }
  pushAttributes(attributes)
}

function shutdown(): void {
  if (typeof window === 'undefined') return
  if (!state) return
  state.scriptTag?.remove()
  // The widget mounts inside a closed shadow DOM under a host element with
  // a stable id; remove the host so a subsequent boot() starts cold.
  document.getElementById('auxx-chat-widget-root')?.remove()
  delete window.__AUXX_CONFIG__
  if (window.AuxxChat && !Array.isArray(window.AuxxChat)) {
    delete window.AuxxChat
  }
  state = null
}

/**
 * Identity rotation. Clears the cached passport so the next request mints
 * fresh, drops the in-memory JWT. Does NOT remove the script tag or hide
 * the widget — the visitor can still chat anonymously after logout if the
 * channel allows it.
 *
 * Use `shutdown()` for a soft teardown (unmount) where the visitor session
 * should survive a re-mount. Use `logout()` when the visitor's identity
 * just changed (logged out, switched accounts).
 */
function logout(): void {
  if (typeof window === 'undefined') return
  if (!state) return
  try {
    window.localStorage.removeItem(`auxx_passport_chat_${state.channelId}`)
  } catch {
    /* ignore */
  }
  state.userJwt = undefined
  const cfg = (window.__AUXX_CONFIG__ ??= {})
  delete cfg.userJwt
}

const Auxx = { boot, update, shutdown, logout }

export default Auxx
export { boot, update, shutdown, logout }

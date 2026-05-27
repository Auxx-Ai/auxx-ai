// packages/chat/src/shared/runtime-config.ts

/**
 * Runtime API base resolution for the widget bundle.
 *
 * The bundle is an IIFE compiled by Vite, so `__AUXX_API_BASE_URL__` is baked
 * in at *our* build time, not the customer's. When the customer self-hosts
 * the npm-shipped bundle (or wants to point it at a different backend
 * mid-session), the browser bootstrap (`@auxx/chat` client entry) sets
 * `window.__AUXX_CONFIG__ = { apiBase, ... }` **before** injecting the
 * script tag. This helper consults that window config first and falls back
 * to the Vite-`define`d default.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    const override = window.__AUXX_CONFIG__?.apiBase
    if (override) return override
  }
  return __AUXX_API_BASE_URL__
}

/**
 * Customer-signed JWT for identity verification. Set by `Auxx.boot({ userJwt })`
 * on the bootstrap config (never persisted to localStorage — JWTs are
 * short-lived and the customer's server mints fresh ones per session). The
 * transport layer reads this on every request and ships it inside
 * `user_data.auxx_user_jwt` so the API can re-verify per call.
 *
 * Returns `null` outside a browser, when boot hasn't run, or when the
 * customer did not pass a JWT.
 */
export function getUserJwt(): string | null {
  if (typeof window === 'undefined') return null
  const token = window.__AUXX_CONFIG__?.userJwt
  return typeof token === 'string' && token.length > 0 ? token : null
}

/**
 * Non-sensitive attributes set on `Auxx.boot({ attributes })` (or merged in
 * later via `Auxx.update()`). These ride alongside the user JWT in the
 * `user_data` envelope so the server can merge them with JWT-verified
 * claims; phase-4 resolution drops same-key conflicts in favor of the JWT.
 *
 * Returns `null` when no boot attributes have been set.
 */
export function getBootAttributes(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  const attrs = window.__AUXX_CONFIG__?.attributes
  if (!attrs || typeof attrs !== 'object') return null
  return Object.keys(attrs).length > 0 ? attrs : null
}

/**
 * Force the widget to mount in the open state, regardless of the channel's
 * saved `autoOpen` setting. Used by the in-app preview surfaces (settings
 * embed pane, dev-tester) so testers don't have to click the launcher every
 * time the iframe reloads. Customers can set it too via `Auxx.boot({ open: true })`.
 *
 * Returns `false` outside a browser or when boot didn't request it.
 */
export function getStartOpen(): boolean {
  if (typeof window === 'undefined') return false
  return window.__AUXX_CONFIG__?.open === true
}

/**
 * Keep the rounded shell corners even when the viewport is small enough to
 * trigger the mobile-fullscreen media query. Used by the settings preview
 * pane so the phone-narrow iframe stays visually rounded.
 */
export function getPreviewRounded(): boolean {
  if (typeof window === 'undefined') return false
  return window.__AUXX_CONFIG__?.previewRounded === true
}

/**
 * Treat the bundle as if a JWT were present for the purpose of deciding
 * whether to render the launcher on `users`-audience channels. Used by the
 * admin settings preview iframe; not part of the public `BootOptions` surface.
 */
export function getPreviewBypassAudience(): boolean {
  if (typeof window === 'undefined') return false
  return window.__AUXX_CONFIG__?.previewBypassAudience === true
}

export interface ChatUserDataEnvelope {
  /** Customer-signed HS256 JWT, verified per-request by the API. */
  auxx_user_jwt?: string
  /** Non-sensitive bag merged with JWT claims by `resolveChatAttributes`. */
  attributes?: Record<string, unknown>
}

/**
 * Compose the `user_data` envelope sent with every chat request. Includes the
 * customer-signed JWT (when boot supplied one) and the boot-time attribute
 * bag (when set). Returns `null` when nothing in the envelope is set, so
 * callers can skip the field entirely.
 */
export function buildUserDataEnvelope(): ChatUserDataEnvelope | null {
  const jwt = getUserJwt()
  const attributes = getBootAttributes()
  if (!jwt && !attributes) return null
  return {
    ...(jwt ? { auxx_user_jwt: jwt } : {}),
    ...(attributes ? { attributes } : {}),
  }
}

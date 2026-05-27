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

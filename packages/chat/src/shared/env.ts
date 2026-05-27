// packages/chat/src/shared/env.ts

/**
 * Build-time / runtime defaults for the npm entry points (`client`, `server`,
 * `react`). The widget *bundle* itself does not consult this file — it reads
 * `window.__AUXX_CONFIG__` via `shared/runtime-config.ts` and falls back to
 * the Vite-`define`d `__AUXX_API_BASE_URL__` constant.
 *
 * Override priority for hosts using the npm shims:
 *   1. Explicit `Auxx.boot({ apiBase, widgetBase })` — runtime args win.
 *   2. Build-time `process.env.AUXX_*` — customer bundler replaces at build.
 *   3. Built-in defaults below, gated by `AUXX_ENV`.
 *
 * Mirrors `packages/sdk/src/env.ts`.
 */

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  const value = process.env[key]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const IS_PROD = readEnv('AUXX_ENV') === 'production'

export const API_URL =
  readEnv('AUXX_API_URL') ?? (IS_PROD ? 'https://api.auxx.ai' : 'http://localhost:3007')

export const WIDGET_URL =
  readEnv('AUXX_WIDGET_URL') ??
  (IS_PROD
    ? 'https://app.auxx.ai/scripts/chat-widget.js'
    : 'http://localhost:3000/scripts/chat-widget.js')

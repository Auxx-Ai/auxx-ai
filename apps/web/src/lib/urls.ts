// apps/web/src/lib/urls.ts
//
// Client-side URL resolution.
//
// The `WEBAPP_URL` / `API_URL` / ... constants from `@auxx/config` MUST NOT be imported
// into browser code. They resolve through a *dynamic* `process.env[key]` read, which no
// bundler can inline, and Next only ships `NEXT_PUBLIC_*` to the browser anyway — so in a
// client bundle both reads return undefined and the constant silently collapses to its
// `http://localhost:<port>` dev fallback. Harmless locally, a hard failure in production.
//
// The server-resolved values are already shipped to the browser: `buildEnvironment()`
// computes them where the env actually exists and the layouts inject them in a
// `beforeInteractive` script, so `window.AUXX_DEHYDRATED_STATE` is populated before any
// client module runs (same guarantee `resource-store.ts` relies on). These helpers read
// that, never the config constants.

/**
 * Base URL for requests back to **this** app — tRPC, REST routes, uploads.
 *
 * Deliberately same-origin. A configured absolute URL would send these cross-origin the
 * moment the app is reached on any other host (preview deploy, domain alias, ngrok), and
 * the session cookie would stop riding along. Same origin as the page is both correct and
 * what the React tRPC client already uses.
 */
export function getBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  return `http://localhost:${process.env.PORT ?? 3000}`
}

/**
 * The canonical, configured app URL — the client-side equivalent of `WEBAPP_URL`.
 *
 * Use this for URLs that **leave the browser**: share links, copied URLs, anything pasted
 * into an email or handed to a third party, where the canonical host matters more than
 * whichever host this particular viewer happened to use. For calling our own API, use
 * {@link getBaseUrl} instead.
 *
 * Falls back to the current origin when the dehydrated state is absent (SSR, or a route
 * whose layout does not inject it) — a same-origin URL is always safer than the localhost
 * fallback the config constant would have produced.
 */
export function getWebappUrl(): string {
  if (typeof window === 'undefined') return getBaseUrl()
  return window.AUXX_DEHYDRATED_STATE?.environment?.appUrl || window.location.origin
}

// packages/lib/src/connections/oauth-callback-url.ts
//
// The single builder for OAuth2 redirect URIs. The authorize route, the callback route,
// and the connect UI that SHOWS the URL to a bring-your-own-client user must all produce
// the same string — a BYO user registers exactly one redirect URI in their provider app,
// and any disagreement surfaces only as an opaque `redirect_uri_mismatch` at the provider.

import { WEBAPP_URL } from '@auxx/config/server'

/**
 * Public base URL a provider redirects back to after consent.
 *
 * `NGROK_URL` points at the tunnel in dev (providers reject localhost redirect URIs);
 * unset in production, where `WEBAPP_URL` applies. A definition may override the base
 * entirely via `oauth2Features.callbackBaseUrl`. Server-side only — `WEBAPP_URL` resolves
 * through a dynamic `process.env[key]` read and collapses to localhost in a browser
 * bundle, which is why the connect surfaces receive this string from the server rather
 * than building it themselves.
 */
export function oauthCallbackBase(callbackBaseUrl?: string | null): string {
  return callbackBaseUrl || process.env.NGROK_URL || WEBAPP_URL
}

/**
 * Redirect URI for a platform-provider connection.
 *
 * The path segment is the provider key, NOT the caller-supplied route param. The route
 * resolves its param as `id OR providerKey`, so echoing the raw param back would make the
 * redirect URI depend on which spelling the caller happened to use — survivable with the
 * platform client (register both), fatal for BYO. Pinning it here keeps authorize,
 * callback, and the displayed URL in agreement by construction.
 */
export function providerOAuthCallbackUrl(
  def: { providerKey?: string | null; id?: string | null },
  callbackBaseUrl?: string | null
): string {
  const segment = def.providerKey ?? def.id ?? ''
  return `${oauthCallbackBase(callbackBaseUrl)}/api/connections/${segment}/oauth2/callback`
}

/**
 * Redirect URI for an app connection. One per app slug, shared by every connection method
 * the app exposes (e.g. `gog-calendar`'s personal and workspace defs both land here).
 */
export function appOAuthCallbackUrl(appSlug: string, callbackBaseUrl?: string | null): string {
  return `${oauthCallbackBase(callbackBaseUrl)}/api/apps/${appSlug}/oauth2/callback`
}

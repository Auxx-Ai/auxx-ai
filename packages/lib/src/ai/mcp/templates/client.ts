// packages/lib/src/ai/mcp/templates/client.ts
//
// Client-safe template helpers — no DB, no server deps, safe to import from browser code.
// (The catalog itself stays server-side; templates reach the client via `mcp.listTemplates`.)

/**
 * Interpolate a template's `createOAuthAppUrl` (the provider's "create OAuth app" form link,
 * authored in the catalog with optional `{callbackUrl}` / `{origin}` placeholders) with the
 * server's OAuth redirect URI. Values are URL-encoded; an unparseable redirect URI leaves
 * `{origin}` empty rather than throwing.
 */
export function buildCreateOAuthAppUrl(rawUrl: string, redirectUri: string): string {
  let origin = ''
  try {
    origin = new URL(redirectUri).origin
  } catch {
    /* keep empty */
  }
  return rawUrl
    .replaceAll('{callbackUrl}', encodeURIComponent(redirectUri))
    .replaceAll('{origin}', encodeURIComponent(origin))
}

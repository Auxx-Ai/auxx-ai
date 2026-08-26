// packages/lib/src/connections/auth-apply.ts
// The one place a resolved connection becomes outgoing HTTP request auth.
// Lifted from the workflow HTTP node's hand-rolled buildAuthHeaders so the HTTP
// node, generic-rest connectors, and future consumers share a single declarative
// path. DB/email/none connections have authApply: null and never reach here.

import type { AuthApply, AuthInsertion } from '@auxx/database'
import { interpolateTemplate } from '@auxx/utils'

export type { AuthApply, AuthInsertion }

/** The canonical bearer-token application: `Authorization: Bearer <token>`. */
export const BEARER_AUTH: AuthApply = {
  in: 'header',
  name: 'Authorization',
  format: 'Bearer {value}',
}

/**
 * Shopify's Admin API does NOT use a bearer token — it reads the access token from its own
 * `X-Shopify-Access-Token` header, and rejects `Authorization: Bearer <token>` with a 401 that
 * looks like a bad credential rather than a bad header.
 *
 * Only the HTTP node and the generic-REST connector consult `authApply`; the Shopify app builds
 * its own requests, which is why every Shopify definition carried the wrong bearer spec unnoticed.
 */
export const SHOPIFY_ADMIN_AUTH: AuthApply = {
  in: 'header',
  name: 'X-Shopify-Access-Token',
  format: '{value}',
}

/**
 * The default auth application for a connection type when none is declared on
 * its definition. An `oauth2-code` access token — and a server-minted
 * `client-credentials` token — is always a bearer token, so app authors needn't
 * restate it (platform defs set it explicitly; app-authored defs often omit it).
 * Secret connections have no universal default — they must declare how their
 * secret is applied. `hosted-provision` never carries a token to apply to a
 * request (its durable handle is a provider-side account id, not a bearer
 * credential), so it always resolves to `null` — same as `secret`.
 */
export function defaultAuthApply(
  connectionType: 'oauth2-code' | 'client-credentials' | 'secret' | 'hosted-provision'
): AuthApply | null {
  return connectionType === 'oauth2-code' || connectionType === 'client-credentials'
    ? BEARER_AUTH
    : null
}

/** A resolved connection, narrowed to what applyAuth reads. */
export interface RuntimeConnectionAuthData {
  /** The resolved token: oauth2 access token, or the primary secret value. */
  value: string
  /** Merged connection-variable map (plain + secret-flagged fields). */
  fields?: Record<string, string>
}

/** The mutable parts of an outgoing request that auth can touch. */
export interface RequestParts {
  headers: Record<string, string>
  url: string
}

/** Interpolate {value} (resolved token/secret) and {fieldKey} placeholders. */
function interpolate(template: string, conn: RuntimeConnectionAuthData): string {
  return interpolateTemplate(template, {
    ...(conn.fields ?? {}),
    // `value` resolves to the resolved token, falling back to a same-named field.
    value: conn.value || conn.fields?.value || '',
  })
}

/** Apply a single credential insertion. Returns a new RequestParts. */
function applyInsertion(
  req: RequestParts,
  conn: RuntimeConnectionAuthData,
  ins: AuthInsertion
): RequestParts {
  const headers = { ...req.headers }
  let url = req.url

  switch (ins.in) {
    case 'header': {
      const name = interpolate(ins.name, conn)
      const value = ins.format ? interpolate(ins.format, conn) : conn.value
      if (name) headers[name] = value
      break
    }
    case 'basic': {
      const user = conn.fields?.[ins.userField ?? 'user'] ?? ''
      const password = conn.fields?.[ins.passwordField ?? 'password'] ?? ''
      const encoded = Buffer.from(`${user}:${password}`).toString('base64')
      headers.Authorization = `Basic ${encoded}`
      break
    }
    case 'query': {
      const value = ins.format ? interpolate(ins.format, conn) : conn.value
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}${encodeURIComponent(ins.name)}=${encodeURIComponent(value)}`
      break
    }
  }

  return { headers, url }
}

/**
 * Apply a connection's declarative auth spec to a request. Returns a new
 * RequestParts (does not mutate the input). Supports a single insertion (the
 * common case) or a multi-insertion spec — each insertion applied in order, then
 * constant `headers` merged verbatim (no interpolation; they are static).
 */
export function applyAuth(
  req: RequestParts,
  conn: RuntimeConnectionAuthData,
  spec: AuthApply | null | undefined
): RequestParts {
  if (!spec) return req

  const insertions = 'insertions' in spec ? spec.insertions : [spec]
  let out: RequestParts = req
  for (const ins of insertions) {
    out = applyInsertion(out, conn, ins)
  }

  if ('insertions' in spec && spec.headers) {
    const headers = { ...out.headers, ...spec.headers }
    out = { headers, url: out.url }
  }

  return out
}

// packages/lib/src/connections/auth-apply.ts
// The one place a resolved connection becomes outgoing HTTP request auth.
// Lifted from the workflow HTTP node's hand-rolled buildAuthHeaders so the HTTP
// node, generic-rest connectors, and future consumers share a single declarative
// path. DB/email/none connections have authApply: null and never reach here.

import type { AuthApply } from '@auxx/database'

export type { AuthApply }

/** The canonical bearer-token application: `Authorization: Bearer <token>`. */
export const BEARER_AUTH: AuthApply = {
  in: 'header',
  name: 'Authorization',
  format: 'Bearer {value}',
}

/**
 * The default auth application for a connection type when none is declared on
 * its definition. An `oauth2-code` access token is always a bearer token, so app
 * authors needn't restate it (platform defs set it explicitly; app-authored defs
 * often omit it). Secret connections have no universal default — they must
 * declare how their secret is applied.
 */
export function defaultAuthApply(connectionType: 'oauth2-code' | 'secret'): AuthApply | null {
  return connectionType === 'oauth2-code' ? BEARER_AUTH : null
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
  const context: Record<string, string> = {
    ...(conn.fields ?? {}),
    // `value` resolves to the resolved token, falling back to a same-named field.
    value: conn.value || conn.fields?.value || '',
  }
  let result = template
  for (const [key, val] of Object.entries(context)) {
    result = result.replaceAll(`{${key}}`, val)
  }
  return result
}

/**
 * Apply a connection's declarative auth spec to a request. Returns a new
 * RequestParts (does not mutate the input).
 */
export function applyAuth(
  req: RequestParts,
  conn: RuntimeConnectionAuthData,
  spec: AuthApply | null | undefined
): RequestParts {
  if (!spec) return req

  const headers = { ...req.headers }
  let url = req.url

  switch (spec.in) {
    case 'header': {
      const name = interpolate(spec.name, conn)
      const value = spec.format ? interpolate(spec.format, conn) : conn.value
      if (name) headers[name] = value
      break
    }
    case 'basic': {
      const user = conn.fields?.user ?? ''
      const password = conn.fields?.password ?? ''
      const encoded = Buffer.from(`${user}:${password}`).toString('base64')
      headers.Authorization = `Basic ${encoded}`
      break
    }
    case 'query': {
      const value = conn.value
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}${encodeURIComponent(spec.name)}=${encodeURIComponent(value)}`
      break
    }
  }

  return { headers, url }
}

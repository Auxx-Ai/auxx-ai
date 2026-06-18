// packages/lib/src/connections/auth-apply.ts
// The one place a resolved connection becomes outgoing HTTP request auth.
// Lifted from the workflow HTTP node's hand-rolled buildAuthHeaders so the HTTP
// node, generic-rest connectors, and future consumers share a single declarative
// path. DB/email/none connections have authApply: null and never reach here.

import type { AuthApply } from '@auxx/database'

export type { AuthApply }

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

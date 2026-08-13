// packages/credentials/src/connections/interpolate-connection.ts

import { decryptValue } from '../crypto'

/**
 * Resolve {key} placeholders across all OAuth connection fields.
 * URL values are URI-encoded; credential values are used as-is.
 * Client id/secret are stored as v2 ciphertext — decrypted before interpolation.
 */
export function interpolateConnectionFields(
  connDef: {
    oauth2AuthorizeUrl: string | null
    oauth2AccessTokenUrl: string | null
    oauth2RefreshUrl: string | null
    oauth2ClientId: string | null
    oauth2ClientSecret: string | null
  },
  variables: Record<string, string>
): {
  authorizeUrl: string
  accessTokenUrl: string
  refreshUrl: string
  clientId: string
  clientSecret: string
} {
  return {
    authorizeUrl: interpolateUrl(connDef.oauth2AuthorizeUrl ?? '', variables),
    accessTokenUrl: interpolateUrl(connDef.oauth2AccessTokenUrl ?? '', variables),
    refreshUrl: interpolateUrl(connDef.oauth2RefreshUrl ?? '', variables),
    clientId: interpolateValue(decryptValue(connDef.oauth2ClientId) ?? '', variables),
    clientSecret: interpolateValue(decryptValue(connDef.oauth2ClientSecret) ?? '', variables),
  }
}

/** Replace {key} in a URL — values are URI-encoded for path safety. */
function interpolateUrl(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(value))
  }
  return result
}

/** Replace {key} in a non-URL value — values used as-is (no encoding). */
function interpolateValue(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

/** Extract {key} placeholder names from a template string. */
export function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{([^}]+)\}/g)
  return matches ? matches.map((m) => m.slice(1, -1)) : []
}

/**
 * Merge a connection's stored variables into one map: plain variables from
 * `metadata.connectionVariables` + secret-flagged ones from the decrypted
 * `secrets.fields`. Secrets win on key collision.
 */
export function mergeConnectionVariables(
  metadata: Record<string, unknown> | null | undefined,
  secrets: { fields?: Record<string, string> } | null | undefined
): Record<string, string> {
  const plain = (metadata?.connectionVariables ?? {}) as Record<string, string>
  return { ...plain, ...(secrets?.fields ?? {}) }
}

// packages/services/src/app-connections/interpolate-connection.ts

/**
 * Resolve {key} placeholders across all OAuth connection fields.
 * URL values are URI-encoded; credential values are used as-is.
 */
export function interpolateConnectionFields(
  connDef: {
    oauth2AuthorizeUrl: string | null
    oauth2AccessTokenUrl: string | null
    oauth2ClientId: string | null
    oauth2ClientSecret: string | null
  },
  variables: Record<string, string>
): {
  authorizeUrl: string
  accessTokenUrl: string
  clientId: string
  clientSecret: string
} {
  return {
    authorizeUrl: interpolateUrl(connDef.oauth2AuthorizeUrl ?? '', variables),
    accessTokenUrl: interpolateUrl(connDef.oauth2AccessTokenUrl ?? '', variables),
    clientId: interpolateValue(connDef.oauth2ClientId ?? '', variables),
    clientSecret: interpolateValue(connDef.oauth2ClientSecret ?? '', variables),
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

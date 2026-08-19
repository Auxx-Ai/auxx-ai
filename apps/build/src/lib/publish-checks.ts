// apps/build/src/lib/publish-checks.ts

/**
 * Minimum character length for content fields
 */
export const MINIMUM_CONTENT_LENGTH = 100

/**
 * App interface for publish validation checks
 */
export interface AppForPublishCheck {
  description: string | null
  category: string | null
  avatarUrl: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  termsOfServiceUrl: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null
  // oauthRedirectUris: string[]
  scopes: string[]
}

/**
 * Check if a string field is valid (non-null, non-empty after trimming)
 */
function isValidStringField(value: string | null): boolean {
  return value !== null && value.trim().length > 0
}

/**
 * Check if a content field meets minimum length requirement
 */
function isValidContentField(value: string | null): boolean {
  return value !== null && value.trim().length >= MINIMUM_CONTENT_LENGTH
}

/**
 * Check if the main app listing has all required fields populated
 * @param app - App data to validate
 * @returns true if all required listing fields are complete
 */
export function isMainAppListingComplete(app: AppForPublishCheck): boolean {
  const checks = {
    category: isValidStringField(app.category),
    description: isValidStringField(app.description),
    // avatarUrl: isValidStringField(app.avatarUrl),
    websiteUrl: isValidStringField(app.websiteUrl),
    documentationUrl: isValidStringField(app.documentationUrl),
    contactUrl: isValidStringField(app.contactUrl),
    termsOfServiceUrl: isValidStringField(app.termsOfServiceUrl),
    contentOverview: isValidContentField(app.contentOverview),
    contentHowItWorks: isValidContentField(app.contentHowItWorks),
    contentConfigure: isValidContentField(app.contentConfigure),
  }

  // const failedChecks = Object.entries(checks)
  //   .filter(([_, isValid]) => !isValid)
  //   .map(([field]) => field)

  return Object.values(checks).every((check) => check)
}

/**
 * Check if OAuth configuration is properly set up
 * @param app - App data to validate
 * @returns true if OAuth is properly configured (only when hasOauth is true)
 */
/**
 * Connection definition shape for publish validation
 */
export interface ConnectionForPublishCheck {
  connectionType: string
  label: string
  oauth2AuthorizeUrl: string | null
  oauth2AccessTokenUrl: string | null
  // Presence-only — credential values never ship on the list path
  hasClientId: boolean
  hasClientSecret: boolean
}

/**
 * Whether a connection mints its own tokens and therefore needs OAuth validation before publish.
 * Types 'secret' and 'none' carry no OAuth config. Keep every publish surface on this predicate —
 * a checklist row that disagrees with it blocks submission with nothing on screen to explain why.
 */
export function isMintingConnection(connection: ConnectionForPublishCheck): boolean {
  return (
    connection.connectionType === 'oauth2-code' ||
    connection.connectionType === 'client-credentials'
  )
}

/**
 * Check that all token-minting connections (oauth2-code, client-credentials) are fully configured.
 * Connections with type 'secret' or 'none' require no validation. `client-credentials` mints with
 * no browser step, so it needs the same fields as oauth2-code minus the Authorize URL.
 *
 * Scopes are deliberately NOT required: plenty of providers (UPS among them) take no scope on the
 * authorize request, and the connections form already treats the field as optional. Demanding one
 * here only forced developers to invent a placeholder that then gets sent to the provider.
 * @returns true if no minting connections exist, or all are properly configured
 */
export function isConnectionsConfigComplete(connections: ConnectionForPublishCheck[]): boolean {
  const mintingConnections = connections.filter(isMintingConnection)
  if (mintingConnections.length === 0) return true

  return mintingConnections.every((c) => {
    const checks = {
      // Authorize URL is required only for the browser-redirect grant.
      oauth2AuthorizeUrl:
        c.connectionType === 'client-credentials' || isValidStringField(c.oauth2AuthorizeUrl),
      oauth2AccessTokenUrl: isValidStringField(c.oauth2AccessTokenUrl),
      oauth2ClientId: c.hasClientId,
      oauth2ClientSecret: c.hasClientSecret,
    }
    return Object.values(checks).every((check) => check)
  })
}

export function isOAuthConfigComplete(app: AppForPublishCheck): boolean {
  // If OAuth is not enabled, this check is not applicable
  if (!app.hasOauth) {
    console.log('ℹ️ OAuth not enabled, skipping OAuth config check')
    return true
  }
  const checks = {
    oauthExternalEntrypointUrl: isValidStringField(app.oauthExternalEntrypointUrl),
    // oauthRedirectUris: app.oauthRedirectUris.length > 0,
    scopes: app.scopes.length > 0,
  }

  // const failedChecks = Object.entries(checks)
  //   .filter(([_, isValid]) => !isValid)
  //   .map(([field]) => field)

  // if (failedChecks.length > 0) {
  //   console.log('❌ OAuth config incomplete. Missing/invalid fields:', failedChecks)
  // } else {
  //   console.log('✅ OAuth config complete')
  // }

  return Object.values(checks).every((check) => check)
}

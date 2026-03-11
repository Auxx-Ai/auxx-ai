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
  oauth2ClientId: string | null
  oauth2ClientSecret: string | null
  oauth2Scopes: string[] | null
}

/**
 * Check if all oauth2-code connections have complete configuration.
 * Connections with type 'secret' or 'none' require no validation.
 * @returns true if no oauth2-code connections exist, or all are properly configured
 */
export function isConnectionsConfigComplete(connections: ConnectionForPublishCheck[]): boolean {
  const oauthConnections = connections.filter((c) => c.connectionType === 'oauth2-code')
  if (oauthConnections.length === 0) return true

  return oauthConnections.every((c) => {
    const checks = {
      oauth2AuthorizeUrl: isValidStringField(c.oauth2AuthorizeUrl),
      oauth2AccessTokenUrl: isValidStringField(c.oauth2AccessTokenUrl),
      oauth2ClientId: isValidStringField(c.oauth2ClientId),
      oauth2ClientSecret: isValidStringField(c.oauth2ClientSecret),
      oauth2Scopes: (c.oauth2Scopes ?? []).length > 0,
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

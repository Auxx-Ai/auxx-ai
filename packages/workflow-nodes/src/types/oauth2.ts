// packages/workflow-nodes/src/types/oauth2.ts

/**
 * URL transformation configuration for dynamic URL building
 */
export interface URLTransform {
  /** Type of transformation to apply */
  type: 'replace' | 'extract' | 'format'

  /** Field name from credential data to use as source */
  source: string

  /** Placeholder in URL template (e.g., '{shop}', '{domain}') */
  target: string

  /** Optional transformation function to apply to source value */
  transform?: (value: string) => string

  /** Description for documentation */
  description?: string
}

/**
 * URL transformation configuration for OAuth2 URLs
 */
export interface URLTransformConfig {
  /** Transforms for authorization URL */
  authUrl?: URLTransform[]

  /** Transforms for token URL */
  tokenUrl?: URLTransform[]
}

/**
 * OAuth2 configuration for credential providers
 */
export interface OAuth2Config {
  /** Provider name (e.g., 'google', 'microsoft') */
  providerName: string

  /** Lucide icon name for UI display */
  icon: string

  /** OAuth2 authorization URL */
  authUrl: string

  /** OAuth2 token exchange URL */
  tokenUrl: string

  /** Environment variable name for system client ID */
  systemClientIdEnv: string

  /** Environment variable name for system client secret */
  systemClientSecretEnv: string

  /** Fixed scopes for this provider */
  scopes: string[]

  /** Additional OAuth2 parameters (optional) */
  additionalAuthParams?: Record<string, string>

  /** Additional token request parameters (optional) */
  additionalTokenParams?: Record<string, string>

  /** Provider-specific UI styling */
  providerStyling?: {
    iconColor?: string // e.g., 'text-red-500'
    backgroundColor?: string // e.g., 'from-red-50 to-orange-50'
    borderColor?: string // e.g., 'border-red-200'
    brandColor?: string // e.g., '#4285f4' for brand-specific styling
  }

  /** URL transformation configuration for dynamic URLs */
  urlTransforms?: URLTransformConfig
}

/**
 * OAuth2 tokens returned from provider
 */
export interface OAuth2Tokens {
  /** Access token for API requests */
  accessToken: string

  /** Refresh token for token renewal */
  refreshToken?: string

  /** Token expiration timestamp */
  expiresAt?: Date

  /** Granted scopes */
  scopes?: string[]

  /** Token type (usually 'Bearer') */
  tokenType?: string

  /** Additional token metadata */
  metadata?: Record<string, any>
}

/**
 * OAuth2 state parameter for callback handling
 */
export interface OAuth2State {
  /** Organization ID */
  organizationId: string

  /** User ID */
  userId: string

  /** Credential type */
  credentialType: string

  /** User-provided credential name */
  credentialName: string

  /** Random state for CSRF protection */
  nonce: string

  /** Timestamp for expiration */
  timestamp: number
}

/**
 * OAuth2 credential data structure (stored encrypted)
 */
export interface OAuth2CredentialData {
  /** Provider identifier */
  provider: string

  /** Access token */
  accessToken: string

  /** Refresh token */
  refreshToken?: string

  /** Granted scopes */
  scopes: string[]

  /** Token expiration */
  expiresAt?: string

  /** Provider-specific metadata */
  metadata: {
    /** User email from provider */
    email?: string

    /** User ID from provider */
    userId?: string

    /** Provider config type */
    providerConfig: string

    /** Additional provider data */
    [key: string]: any
  }
}

/**
 * OAuth2 flow initiation response
 */
export interface OAuth2InitiationResponse {
  /** OAuth2 authorization URL to redirect to */
  authUrl: string

  /** State parameter for callback validation */
  state: string
}

/**
 * OAuth2 callback processing result
 */
export interface OAuth2CallbackResult {
  /** Success status */
  success: boolean

  /** Created credential ID */
  credentialId?: string

  /** Error message if failed */
  error?: string

  /** User info from provider */
  userInfo?: {
    email?: string
    name?: string
    userId?: string
  }
}

/**
 * Type guard to check if credential type has OAuth2 config
 */
export function hasOAuth2Config(
  credentialType: any
): credentialType is { oauth2Config: OAuth2Config } {
  return (
    credentialType &&
    typeof credentialType === 'object' &&
    'oauth2Config' in credentialType &&
    typeof credentialType.oauth2Config === 'object' &&
    credentialType.oauth2Config !== null
  )
}

// packages/services/src/app-connections/types.ts

import type { Result } from 'neverthrow'
import type { getAppConnectionDefinition } from './get-app-connection-definition'

/**
 * Utility type to extract the Ok type from a Promise<Result<T, E>>
 *
 * This helper type unwraps the Promise layer using TypeScript's built-in Awaited utility,
 * then uses conditional types with infer to extract the Ok value type from neverthrow's Result.
 *
 * @template T - A Promise that resolves to a Result type
 * @returns The Ok value type from the Result, or never if T is not a Promise<Result>
 *
 * @example
 * type MyResult = Promise<Result<string, Error>>
 * type Unwrapped = UnwrapOk<MyResult> // string
 */
type UnwrapOk<T> = Awaited<T> extends Result<infer O, any> ? O : never

/**
 * Decrypted connection data structure
 *
 * This interface represents the decrypted credential data that is stored in the
 * WorkflowCredentials table. The data is encrypted at rest using the CredentialService,
 * and this interface describes the structure after decryption.
 *
 * @interface DecryptedConnectionData
 *
 * @property {string} [accessToken] - OAuth2 access token for API authentication.
 *                                    Present when connectionType is 'oauth2-code'.
 * @property {string} [refreshToken] - OAuth2 refresh token for obtaining new access tokens.
 *                                     Present when connectionType is 'oauth2-code'.
 * @property {string} [secret] - API key or secret for authentication.
 *                               Present when connectionType is 'secret'.
 * @property {Record<string, unknown>} [metadata] - Additional connection-specific metadata
 *                                                  such as scopes, token type, user info, etc.
 * @property {string} [expiresAt] - ISO 8601 timestamp indicating when the access token expires.
 *                                  Primarily used for OAuth2 connections.
 */
export interface DecryptedConnectionData {
  accessToken?: string
  refreshToken?: string
  secret?: string
  metadata?: Record<string, unknown>
  expiresAt?: string
}

/**
 * Connection definition with only public-facing fields
 *
 * This type represents the public-facing information about a connection definition
 * for an app. It excludes sensitive fields like OAuth2 client secrets and URLs.
 * Used primarily for display purposes in the UI.
 *
 * The type is automatically inferred from the return type of getAppConnectionDefinition,
 * ensuring it stays in sync with the actual data structure returned by the function.
 *
 * @typedef ConnectionDefinitionSummary
 *
 * @property {string} label - Human-readable label for the connection (e.g., "Gmail Account").
 * @property {boolean | null} global - Whether this is an organization-scoped (true) or user-scoped (false) connection.
 *                                     Organization connections are shared across all users in the org.
 * @property {string} connectionType - The authentication method (e.g., 'oauth2-code', 'secret', 'none'):
 *                                     - 'oauth2-code': OAuth2 authorization code flow
 *                                     - 'secret': API key or secret
 *                                     - 'none': No authentication required
 */
export type ConnectionDefinitionSummary = UnwrapOk<ReturnType<typeof getAppConnectionDefinition>>

/**
 * Active connection details
 *
 * This interface represents an active app connection with metadata about its status
 * and creation. Used for listing and displaying connections in the UI.
 *
 * @interface AppConnection
 *
 * @property {string} id - Unique identifier for the connection (WorkflowCredentials.id).
 * @property {string} appId - The ID of the app this connection belongs to.
 * @property {string} appName - Human-readable name of the app (e.g., "Gmail", "Shopify").
 * @property {'connected' | 'not_connected' | 'expired'} connectionStatus - Current status of the connection:
 *                                                                          - 'connected': Active and valid
 *                                                                          - 'not_connected': Not yet configured
 *                                                                          - 'expired': Token has expired (OAuth2)
 * @property {string} [connectedBy] - Name of the user who created this connection.
 * @property {Date} [connectedAt] - Timestamp when the connection was created.
 * @property {Date} [expiresAt] - Timestamp when the connection expires (for OAuth2 connections).
 * @property {boolean} global - Whether this is an organization-scoped (true) or user-scoped (false) connection.
 */
export interface AppConnection {
  id: string
  appId: string
  appName: string
  connectionStatus: 'connected' | 'not_connected' | 'expired'
  connectedBy?: string // User name
  connectedAt?: Date
  expiresAt?: Date
  global: boolean
}

/**
 * Connection data for runtime context
 *
 * This interface represents connection data that is passed to the app runtime executor.
 * It contains the decrypted authentication credentials needed for the app to make
 * API calls on behalf of the user or organization.
 *
 * @interface RuntimeConnectionData
 *
 * @property {string} id - Unique identifier for the connection (WorkflowCredentials.id).
 * @property {'oauth2-code' | 'secret'} type - The authentication method used by this connection.
 * @property {string} value - The actual credential value (access token or API secret).
 *                            This is the decrypted sensitive data.
 * @property {any} [metadata] - Additional connection metadata such as OAuth2 scopes,
 *                              token type, user information, etc.
 * @property {string} [expiresAt] - ISO 8601 timestamp indicating when the access token expires.
 *                                  Used for OAuth2 connections to determine if token refresh is needed.
 */
export interface RuntimeConnectionData {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string
  metadata?: any
  expiresAt?: string
}

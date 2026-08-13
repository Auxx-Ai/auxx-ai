// packages/credentials/src/connections/types.ts

/**
 * Decrypted connection data structure.
 *
 * Represents the credential data stored in the `Credential` table after decryption — secrets are
 * encrypted at rest via the credential store (crypto v2).
 *
 * @property accessToken  OAuth2 access token. Present when connectionType is 'oauth2-code'.
 * @property refreshToken OAuth2 refresh token. Present when connectionType is 'oauth2-code'.
 * @property secret       API key or secret. Present when connectionType is 'secret'.
 * @property fields       Secret-flagged connection variables, keyed by variable key. Nested so
 *                        user-defined keys can't collide with the reserved secret keys.
 * @property metadata     Connection-specific metadata such as scopes, token type, user info.
 * @property expiresAt    ISO 8601 timestamp for access-token expiry (OAuth2 connections).
 */
export interface DecryptedConnectionData {
  accessToken?: string
  refreshToken?: string
  secret?: string
  fields?: Record<string, string>
  metadata?: Record<string, unknown>
  expiresAt?: string
}

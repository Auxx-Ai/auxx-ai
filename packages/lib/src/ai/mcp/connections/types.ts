// packages/lib/src/ai/mcp/connections/types.ts

/**
 * Decrypted MCP connection payload (mirrors the app connection shape).
 * Stored encrypted in Credential.encryptedSecrets with kind 'mcp'.
 */
export interface DecryptedConnectionData {
  accessToken?: string
  refreshToken?: string
  secret?: string
  /** Custom-header auth: full header name → value map (values are secrets). */
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
  expiresAt?: string
}

/**
 * Connection resolved for runtime use. `type: 'none'` carries no credential value.
 */
export interface McpRuntimeConnection {
  id: string
  type: 'oauth2-code' | 'secret' | 'none'
  value: string
  /** Custom-header auth — wins over the single-value Authorization path when present. */
  headers?: Record<string, string>
  metadata?: Record<string, unknown>
  expiresAt?: string
  /** True when a refresh token is stored — the 401 retry path is worth attempting. */
  hasRefreshToken?: boolean
}

/** Error shape for the neverthrow connection results. */
export interface McpConnectionError {
  code: 'DATABASE_ERROR' | 'CONNECTION_NOT_FOUND' | 'DECRYPTION_ERROR' | 'CONNECTION_CREATE_FAILED'
  message: string
}

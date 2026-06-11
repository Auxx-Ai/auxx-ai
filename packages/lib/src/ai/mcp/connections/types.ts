// packages/lib/src/ai/mcp/connections/types.ts

/**
 * Decrypted MCP connection payload (mirrors the app-connection shape).
 * Stored encrypted in WorkflowCredentials.encryptedData with type 'mcp-connection'.
 */
export interface DecryptedConnectionData {
  accessToken?: string
  refreshToken?: string
  secret?: string
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
  metadata?: Record<string, unknown>
  expiresAt?: string
}

/** Error shape for the neverthrow connection results. */
export interface McpConnectionError {
  code: 'DATABASE_ERROR' | 'CONNECTION_NOT_FOUND' | 'DECRYPTION_ERROR' | 'CONNECTION_CREATE_FAILED'
  message: string
}

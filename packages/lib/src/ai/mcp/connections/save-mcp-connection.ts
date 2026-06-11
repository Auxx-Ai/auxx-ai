// packages/lib/src/ai/mcp/connections/save-mcp-connection.ts

import {
  findCredential,
  insertCredential,
  rotateSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import type { McpConnectionError } from './types'

const logger = createScopedLogger('save-mcp-connection')

/** Pick the secret keys (present only) out of an MCP connection's credential data. */
function pickSecrets(data: {
  accessToken?: string
  refreshToken?: string
  secret?: string
}): Record<string, unknown> {
  const secrets: Record<string, unknown> = {}
  if (data.accessToken !== undefined) secrets.accessToken = data.accessToken
  if (data.refreshToken !== undefined) secrets.refreshToken = data.refreshToken
  if (data.secret !== undefined) secrets.secret = data.secret
  return secrets
}

/**
 * Save (or update on reconnect) the org-wide credential for an MCP server.
 *
 * Mirrors `saveAppConnection`: secrets are encrypted via the credential store, non-secret data
 * (e.g. connection variables, auth header name) goes in plaintext `metadata`, and `expiresAt`
 * lives only as a column. MCP connections are org-wide only in v1 (`userId: null`).
 */
export async function saveMcpConnection(input: {
  mcpServerId: string
  serverName: string
  organizationId: string
  createdById: string
  connectionData: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    secret?: string
    metadata?: Record<string, unknown>
  }
  /** When provided, update that credential row in place (reconnect flow). */
  connectionId?: string
}): Promise<Result<string, McpConnectionError>> {
  const { mcpServerId, serverName, organizationId, createdById, connectionData } = input
  let { connectionId } = input

  const secrets = pickSecrets(connectionData)
  const metadata = (connectionData.metadata ?? {}) as Record<string, unknown>
  const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null

  // MCP connections are org-wide singletons per server — a repeat connect (e.g. retried OAuth)
  // rotates the existing credential instead of stacking a second row.
  if (!connectionId) {
    const existing = await findCredential({
      organizationId,
      kind: 'mcp',
      mcpServerId,
      userId: null,
    })
    if (existing.isOk() && existing.value) connectionId = existing.value.id
  }

  if (connectionId) {
    const rotated = await rotateSecrets(connectionId, organizationId, secrets, { expiresAt })
    if (rotated.isErr()) {
      logger.error('Failed to reconnect MCP connection', {
        connectionId,
        mcpServerId,
        error: rotated.error.message,
      })
      return err({ code: 'DATABASE_ERROR', message: 'Failed to save MCP connection' })
    }
    const metaUpdated = await updateCredential(connectionId, organizationId, { metadata })
    if (metaUpdated.isErr()) {
      return err({ code: 'DATABASE_ERROR', message: 'Failed to save MCP connection' })
    }
    logger.info('Reconnected MCP connection', { connectionId, mcpServerId })
    return ok(connectionId)
  }

  const created = await insertCredential({
    organizationId,
    createdById,
    kind: 'mcp',
    userId: null,
    mcpServerId,
    name: `${serverName} Connection`,
    secrets,
    metadata,
    expiresAt,
  })

  if (created.isErr()) {
    logger.error('Failed to save MCP connection', {
      mcpServerId,
      error: created.error.message,
    })
    return err({ code: 'CONNECTION_CREATE_FAILED', message: 'Failed to create MCP connection' })
  }

  logger.info('Created MCP connection', { connectionId: created.value.id, mcpServerId })
  return ok(created.value.id)
}

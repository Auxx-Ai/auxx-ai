// packages/lib/src/ai/mcp/connections/save-mcp-connection.ts

import { CredentialService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { McpConnectionError } from './types'

const logger = createScopedLogger('save-mcp-connection')

/**
 * Save (or update on reconnect) the org-wide credential for an MCP server.
 *
 * Mirrors `saveAppConnection`'s direct insert into WorkflowCredentials — encrypts via
 * `CredentialService.encrypt` and hardcodes `type: 'mcp-connection'`. MCP connections are
 * org-wide only in v1 (`userId: null`).
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
  const { mcpServerId, serverName, organizationId, createdById, connectionData, connectionId } =
    input

  // CredentialService.encrypt just JSON-serializes; the NodeData shape is stricter than our
  // metadata bag, so cast through any (matches saveAppConnection).
  const encrypted = CredentialService.encrypt(connectionData as any)
  const expiresAt = connectionData.expiresAt ? new Date(connectionData.expiresAt) : null
  const now = new Date()

  try {
    if (connectionId) {
      await db
        .update(schema.WorkflowCredentials)
        .set({ encryptedData: encrypted, expiresAt, updatedAt: now })
        .where(
          and(
            eq(schema.WorkflowCredentials.id, connectionId),
            eq(schema.WorkflowCredentials.organizationId, organizationId)
          )
        )
      logger.info('Reconnected MCP connection', { connectionId, mcpServerId })
      return ok(connectionId)
    }

    const [created] = await db
      .insert(schema.WorkflowCredentials)
      .values({
        organizationId,
        createdById,
        userId: null,
        appId: null,
        mcpServerId,
        name: `${serverName} Connection`,
        type: 'mcp-connection',
        encryptedData: encrypted,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.WorkflowCredentials.id })

    if (!created) {
      return err({ code: 'CONNECTION_CREATE_FAILED', message: 'Failed to create MCP connection' })
    }

    logger.info('Created MCP connection', { connectionId: created.id, mcpServerId })
    return ok(created.id)
  } catch (error) {
    logger.error('Failed to save MCP connection', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err({ code: 'DATABASE_ERROR', message: 'Failed to save MCP connection' })
  }
}

// packages/lib/src/ai/mcp/connections/delete-mcp-connection.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { McpConnectionError } from './types'

const logger = createScopedLogger('delete-mcp-connection')

/** Delete all `mcp-connection` credential rows for an org/server pair. */
export async function deleteMcpConnection(input: {
  mcpServerId: string
  organizationId: string
}): Promise<Result<void, McpConnectionError>> {
  const { mcpServerId, organizationId } = input
  try {
    await db
      .delete(schema.WorkflowCredentials)
      .where(
        and(
          eq(schema.WorkflowCredentials.mcpServerId, mcpServerId),
          eq(schema.WorkflowCredentials.organizationId, organizationId),
          eq(schema.WorkflowCredentials.type, 'mcp-connection')
        )
      )
    return ok(undefined)
  } catch (error) {
    logger.error('Failed to delete MCP connection', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err({ code: 'DATABASE_ERROR', message: 'Failed to delete MCP connection' })
  }
}

// packages/lib/src/ai/mcp/connections/mark-mcp-connection-failed.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'

const logger = createScopedLogger('mark-mcp-connection-failed')

/**
 * Bump the circuit-breaker counter on an MCP server's org-wide credential after an auth
 * failure (401/McpAuthError at call time). Fire-and-forget — best effort, never throws.
 * Once `consecutiveRefreshFailures >= 5` the settings UI surfaces a "needs reconnect" pill.
 */
export async function markMcpConnectionFailed(input: {
  mcpServerId: string
  organizationId: string
}): Promise<void> {
  const { mcpServerId, organizationId } = input
  try {
    await db
      .update(schema.WorkflowCredentials)
      .set({
        consecutiveRefreshFailures: sql`${schema.WorkflowCredentials.consecutiveRefreshFailures} + 1`,
        lastRefreshFailureAt: new Date(),
      })
      .where(
        and(
          eq(schema.WorkflowCredentials.mcpServerId, mcpServerId),
          eq(schema.WorkflowCredentials.organizationId, organizationId),
          isNull(schema.WorkflowCredentials.userId),
          eq(schema.WorkflowCredentials.type, 'mcp-connection')
        )
      )
  } catch (error) {
    logger.warn('Failed to mark MCP connection failed', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

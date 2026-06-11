// packages/lib/src/ai/mcp/connections/mark-mcp-connection-failed.ts

import { findCredential, recordRefreshFailure } from '@auxx/credentials/store'
import { createScopedLogger } from '@auxx/logger'

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
    const found = await findCredential({ kind: 'mcp', mcpServerId, organizationId, userId: null })
    if (found.isErr() || !found.value) return
    await recordRefreshFailure(found.value.id, organizationId)
  } catch (error) {
    logger.warn('Failed to mark MCP connection failed', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

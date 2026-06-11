// packages/lib/src/ai/mcp/connections/delete-mcp-connection.ts

import { deleteCredential, findCredential } from '@auxx/credentials/store'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import type { McpConnectionError } from './types'

const logger = createScopedLogger('delete-mcp-connection')

/**
 * Delete the org-wide `mcp` credential for a server. MCP connections are org-wide single in v1,
 * but loop defensively so any stray duplicate row is cleared too.
 */
export async function deleteMcpConnection(input: {
  mcpServerId: string
  organizationId: string
}): Promise<Result<void, McpConnectionError>> {
  const { mcpServerId, organizationId } = input

  // Bounded loop — guards against an unexpected duplicate without risking an infinite loop.
  for (let i = 0; i < 50; i++) {
    const found = await findCredential({ kind: 'mcp', mcpServerId, organizationId, userId: null })
    if (found.isErr()) {
      logger.error('Failed to look up MCP connection', {
        mcpServerId,
        error: found.error.message,
      })
      return err({ code: 'DATABASE_ERROR', message: 'Failed to delete MCP connection' })
    }
    if (!found.value) return ok(undefined)

    const deleted = await deleteCredential(found.value.id, organizationId)
    if (deleted.isErr()) {
      logger.error('Failed to delete MCP connection', {
        mcpServerId,
        error: deleted.error.message,
      })
      return err({ code: 'DATABASE_ERROR', message: 'Failed to delete MCP connection' })
    }
  }

  return ok(undefined)
}

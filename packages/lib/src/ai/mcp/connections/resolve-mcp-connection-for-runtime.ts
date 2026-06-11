// packages/lib/src/ai/mcp/connections/resolve-mcp-connection-for-runtime.ts

import { findCredential, revealSecrets } from '@auxx/credentials/store'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import type { McpConnectionError, McpRuntimeConnection } from './types'

const logger = createScopedLogger('resolve-mcp-connection-for-runtime')

/** Secret material stored for an MCP connection. */
interface McpSecrets {
  accessToken?: string
  refreshToken?: string
  secret?: string
}

/**
 * Resolve the org-wide connection for an MCP server, ready for runtime use.
 *
 * Simpler than the app version (org-only, no per-user scope):
 * 1. Look up the ConnectionDefinition for the server to learn its `connectionType`.
 * 2. `none` with no credential → return `{ type: 'none', value: '' }`.
 * 3. Otherwise reveal the org-wide `mcp` credential and return its token/secret + metadata.
 */
export async function resolveMcpConnectionForRuntime(input: {
  mcpServerId: string
  organizationId: string
}): Promise<Result<McpRuntimeConnection, McpConnectionError>> {
  const { mcpServerId, organizationId } = input

  let connectionType: 'oauth2-code' | 'secret' | 'none'
  try {
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (def, { eq }) => eq(def.mcpServerId, mcpServerId),
      columns: { connectionType: true },
    })
    connectionType = (connDef?.connectionType ?? 'none') as 'oauth2-code' | 'secret' | 'none'
  } catch (error) {
    logger.error('Failed to load MCP connection definition', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err({ code: 'DATABASE_ERROR', message: 'Failed to load connection definition' })
  }

  const found = await findCredential({ kind: 'mcp', mcpServerId, organizationId, userId: null })
  if (found.isErr()) {
    logger.error('Failed to load MCP credential', { mcpServerId, error: found.error.message })
    return err({ code: 'DATABASE_ERROR', message: 'Failed to load MCP credential' })
  }
  const credential = found.value

  // `none`-auth servers carry no token, but may still have a credential row holding connection
  // variables (e.g. Shopify's shop subdomain) used to interpolate the endpoint.
  if (connectionType === 'none' && !credential) {
    return ok({ id: '', type: 'none', value: '' })
  }

  if (!credential) {
    return err({ code: 'CONNECTION_NOT_FOUND', message: 'MCP connection not found' })
  }

  const revealed = await revealSecrets<McpSecrets>(credential.id, organizationId)
  if (revealed.isErr()) {
    logger.error('Failed to decrypt MCP credential', {
      mcpServerId,
      credentialId: credential.id,
      error: revealed.error.message,
    })
    return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt MCP credential' })
  }

  const { record, secrets } = revealed.value
  return ok({
    id: record.id,
    type: connectionType,
    value: secrets.accessToken || secrets.secret || '',
    metadata: record.metadata,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : undefined,
  })
}

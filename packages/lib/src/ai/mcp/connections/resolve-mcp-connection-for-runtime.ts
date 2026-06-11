// packages/lib/src/ai/mcp/connections/resolve-mcp-connection-for-runtime.ts

import { CredentialService } from '@auxx/credentials'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import type { DecryptedConnectionData, McpConnectionError, McpRuntimeConnection } from './types'

const logger = createScopedLogger('resolve-mcp-connection-for-runtime')

/**
 * Resolve the org-wide connection for an MCP server, ready for runtime use.
 *
 * Simpler than the app version (org-only, no per-user scope):
 * 1. Look up the ConnectionDefinition for the server to learn its `connectionType`.
 * 2. `none` → return `{ type: 'none', value: '' }` with no credential lookup.
 * 3. Otherwise decrypt the org-wide `mcp-connection` credential and return its token/secret.
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

  let cred: { id: string; encryptedData: string } | undefined
  try {
    cred = await db.query.WorkflowCredentials.findFirst({
      where: (creds, { eq, and, isNull }) =>
        and(
          eq(creds.mcpServerId, mcpServerId),
          eq(creds.organizationId, organizationId),
          isNull(creds.userId),
          eq(creds.type, 'mcp-connection')
        ),
      columns: { id: true, encryptedData: true },
    })
  } catch (error) {
    logger.error('Failed to load MCP credential', {
      mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return err({ code: 'DATABASE_ERROR', message: 'Failed to load MCP credential' })
  }

  // `none`-auth servers carry no token, but may still have a credential row holding connection
  // variables (e.g. Shopify's shop subdomain) used to interpolate the endpoint.
  if (connectionType === 'none' && !cred) {
    return ok({ id: '', type: 'none', value: '' })
  }

  if (!cred) {
    return err({ code: 'CONNECTION_NOT_FOUND', message: 'MCP connection not found' })
  }

  try {
    const decrypted = CredentialService.decrypt(cred.encryptedData) as DecryptedConnectionData
    return ok({
      id: cred.id,
      type: connectionType,
      value: decrypted.accessToken || decrypted.secret || '',
      metadata: decrypted.metadata,
      expiresAt: decrypted.expiresAt,
    })
  } catch (error) {
    logger.error('Failed to decrypt MCP credential', { mcpServerId, credentialId: cred.id, error })
    return err({ code: 'DECRYPTION_ERROR', message: 'Failed to decrypt MCP credential' })
  }
}

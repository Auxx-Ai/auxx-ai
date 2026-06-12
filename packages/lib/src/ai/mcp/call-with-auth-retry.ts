// packages/lib/src/ai/mcp/call-with-auth-retry.ts

import { createScopedLogger } from '@auxx/logger'
import { ensureFreshCredentialToken } from '../../credentials/ensure-fresh-credential-token'
import { buildMcpRequestContext } from './auth'
import { mcpCallTool } from './client'
import { markMcpConnectionFailed } from './connections'
import { McpAuthError } from './errors'
import type { McpCallResult } from './types'

const logger = createScopedLogger('mcp-call-with-auth-retry')

export type McpCallOutcome =
  | { ok: true; result: McpCallResult }
  /** Request context could not be built (server/connection missing). */
  | { ok: false; kind: 'context'; message: string }
  /** Auth failed and could not be recovered — connection flagged for reconnect. */
  | { ok: false; kind: 'auth'; message: string }
  /** Any other transport/tool failure — caller maps via `mapMcpError`. */
  | { ok: false; kind: 'error'; error: unknown }

const AUTH_FAILED_MESSAGE = 'MCP server auth failed — an admin may need to reconnect.'

/**
 * Build the request context and call one MCP tool, recovering from auth failures: on a 401, if
 * the connection is OAuth with a stored refresh token, force-refresh the credential (single-flight
 * — the lazy expiry check is bypassed because the token just failed live), rebuild the context,
 * and retry once. A recovered call never touches the failure counter; only an unrecoverable auth
 * failure marks the connection for reconnect. Shared by the agent tool adapter and the admin
 * test-run path.
 */
export async function callMcpToolWithAuthRetry(opts: {
  mcpServerId: string
  organizationId: string
  toolName: string
  args: Record<string, unknown>
}): Promise<McpCallOutcome> {
  const { mcpServerId, organizationId, toolName, args } = opts

  const ctxResult = await buildMcpRequestContext({ mcpServerId, organizationId })
  if (ctxResult.isErr()) {
    return { ok: false, kind: 'context', message: ctxResult.error.message }
  }

  try {
    const result = await mcpCallTool(
      { endpoint: ctxResult.value.endpoint, headers: ctxResult.value.headers },
      toolName,
      args
    )
    return { ok: true, result }
  } catch (error) {
    if (!(error instanceof McpAuthError)) return { ok: false, kind: 'error', error }

    const { connectionType, hasRefreshToken, connectionId } = ctxResult.value
    if (connectionType === 'oauth2-code' && hasRefreshToken && connectionId) {
      logger.info('MCP call got 401 — refreshing token and retrying', { mcpServerId, toolName })
      await ensureFreshCredentialToken({
        credentialId: connectionId,
        organizationId,
        hasRefreshToken: true,
        force: true,
      })
      const retryCtx = await buildMcpRequestContext({ mcpServerId, organizationId })
      if (retryCtx.isOk()) {
        try {
          const result = await mcpCallTool(
            { endpoint: retryCtx.value.endpoint, headers: retryCtx.value.headers },
            toolName,
            args
          )
          return { ok: true, result }
        } catch (retryError) {
          if (!(retryError instanceof McpAuthError)) {
            return { ok: false, kind: 'error', error: retryError }
          }
        }
      }
    }

    // Unrecoverable: no refresh possible, or the refreshed token still 401s.
    void markMcpConnectionFailed({ mcpServerId, organizationId })
    return { ok: false, kind: 'auth', message: AUTH_FAILED_MESSAGE }
  }
}

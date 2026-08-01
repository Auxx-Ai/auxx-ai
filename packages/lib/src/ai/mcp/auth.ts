// packages/lib/src/ai/mcp/auth.ts

import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { resolveMcpConnectionForRuntime } from './connections'
import type { CachedMcpServer } from './types'

export interface McpRequestContext {
  endpoint: string
  headers: Record<string, string>
  connectionId?: string
  connectionType?: 'oauth2-code' | 'secret' | 'none'
  /** True when a stored refresh token makes a refresh-and-retry on 401 worthwhile. */
  hasRefreshToken?: boolean
}

export interface McpAuthErrorResult {
  code: 'SERVER_NOT_FOUND' | 'CONNECTION_ERROR'
  message: string
}

/**
 * Narrow the cached server's `connectionType` to the three values MCP actually persists.
 *
 * `CachedMcpServer.connectionType` is typed off the generic ConnectionDefinition vocabulary
 * (which also has `client-credentials` and `hosted-provision`), but every MCP write path
 * (`createCustomMcpServer`, `updateMcpServer`, the curated templates) only ever stores
 * `oauth2-code`, `secret` or `none`. Anything else would be a foreign definition attached to an
 * MCP server; treat it as `secret` — "a credential is required and bearered", which is what the
 * runtime already did for those values before this narrowing.
 */
function toMcpConnectionType(
  connectionType: CachedMcpServer['connectionType']
): 'oauth2-code' | 'secret' | 'none' {
  if (connectionType === 'oauth2-code' || connectionType === 'none') return connectionType
  return connectionType === null ? 'none' : 'secret'
}

/** Extract `{key}` placeholder names from a template string (local copy — avoids cross-pkg import). */
function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{([^}]+)\}/g)
  return matches ? matches.map((m) => m.slice(1, -1)) : []
}

/** Replace `{key}` placeholders in the endpoint with URI-encoded connection-variable values. */
function interpolateEndpoint(endpoint: string, variables: Record<string, string>): string {
  let result = endpoint
  for (const key of extractPlaceholders(endpoint)) {
    if (variables[key] !== undefined) {
      result = result.replaceAll(`{${key}}`, encodeURIComponent(variables[key]))
    }
  }
  return result
}

/**
 * Build the per-call request context (endpoint + auth headers) for an MCP server:
 * 1. Resolve the server's endpoint + connection type from the org cache (the same snapshot the
 *    tool adapter runs against — no per-call DB roundtrips for static server data).
 * 2. Resolve the org-wide connection (none / secret / oauth2-code) — credential secrets always
 *    come fresh from the DB, never the cache.
 * 3. `none` → no header; `secret`/`oauth2-code` → `Authorization: Bearer <value>`.
 * 4. Interpolate `{placeholders}` in the endpoint from `metadata.connectionVariables`.
 */
export async function buildMcpRequestContext(opts: {
  mcpServerId: string
  organizationId: string
}): Promise<Result<McpRequestContext, McpAuthErrorResult>> {
  const servers = await getOrgCache().get(opts.organizationId, 'mcpServers')
  const server = servers.find((s) => s.serverId === opts.mcpServerId)
  if (!server) {
    return err({ code: 'SERVER_NOT_FOUND', message: `MCP server ${opts.mcpServerId} not found` })
  }

  const resolved = await resolveMcpConnectionForRuntime({
    mcpServerId: opts.mcpServerId,
    organizationId: opts.organizationId,
    connectionType: toMcpConnectionType(server.connectionType),
  })
  if (resolved.isErr()) {
    return err({ code: 'CONNECTION_ERROR', message: resolved.error.message })
  }

  const connection = resolved.value
  const variables = (connection.metadata?.connectionVariables as Record<string, string>) ?? {}
  const endpoint = interpolateEndpoint(server.endpoint, variables)

  const headers: Record<string, string> = {}
  if (connection.headers && Object.keys(connection.headers).length > 0) {
    // Custom-header auth: the connection carries a full name → value map.
    Object.assign(headers, connection.headers)
  } else if (connection.type !== 'none' && connection.value) {
    // Custom-header escape hatch: pasted remotes are often `X-API-Key: <secret>` rather than
    // `Authorization: Bearer`. `metadata.authHeader` overrides the default header name/prefix.
    const authHeader = connection.metadata?.authHeader as
      | { name: string; prefix?: string }
      | undefined
    if (authHeader?.name) {
      headers[authHeader.name] = `${authHeader.prefix ?? ''}${connection.value}`
    } else {
      headers.Authorization = `Bearer ${connection.value}`
    }
  }

  return ok({
    endpoint,
    headers,
    connectionId: connection.id || undefined,
    connectionType: connection.type,
    hasRefreshToken: connection.hasRefreshToken,
  })
}

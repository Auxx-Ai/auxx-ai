// packages/lib/src/ai/mcp/auth.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { resolveMcpConnectionForRuntime } from './connections'

export interface McpRequestContext {
  endpoint: string
  headers: Record<string, string>
  connectionId?: string
}

export interface McpAuthErrorResult {
  code: 'SERVER_NOT_FOUND' | 'CONNECTION_ERROR'
  message: string
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
 * 1. Load the McpServer row → endpoint.
 * 2. Resolve the org-wide connection (none / secret / oauth2-code).
 * 3. `none` → no header; `secret`/`oauth2-code` → `Authorization: Bearer <value>`.
 * 4. Interpolate `{placeholders}` in the endpoint from `metadata.connectionVariables`.
 */
export async function buildMcpRequestContext(opts: {
  mcpServerId: string
  organizationId: string
}): Promise<Result<McpRequestContext, McpAuthErrorResult>> {
  const server = await db.query.McpServer.findFirst({
    where: eq(schema.McpServer.id, opts.mcpServerId),
    columns: { endpoint: true },
  })
  if (!server) {
    return err({ code: 'SERVER_NOT_FOUND', message: `MCP server ${opts.mcpServerId} not found` })
  }

  const resolved = await resolveMcpConnectionForRuntime({
    mcpServerId: opts.mcpServerId,
    organizationId: opts.organizationId,
  })
  if (resolved.isErr()) {
    return err({ code: 'CONNECTION_ERROR', message: resolved.error.message })
  }

  const connection = resolved.value
  const variables = (connection.metadata?.connectionVariables as Record<string, string>) ?? {}
  const endpoint = interpolateEndpoint(server.endpoint, variables)

  const headers: Record<string, string> = {}
  if (connection.type !== 'none' && connection.value) {
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

  return ok({ endpoint, headers, connectionId: connection.id || undefined })
}

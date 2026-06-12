// packages/lib/src/ai/mcp/test-tool.ts
// Admin "test run" of a single MCP tool from the server detail page. Mirrors the tool-adapter's
// posture (rate limit, tolerant ajv, auth-failure → reconnect) but returns the raw result to the
// caller instead of wrapping it for a model, and infers a result schema for the schema editor.

import { createScopedLogger } from '@auxx/logger'
import Ajv from 'ajv'
import { getOrgCache } from '../../cache'
import { inferJsonSchema, type JsonSchema } from '../../json-schema'
import { buildMcpRequestContext } from './auth'
import { mcpCallTool } from './client'
import { markMcpConnectionFailed } from './connections'
import { McpAuthError, mapMcpError } from './errors'
import { checkAndCountMcpCall } from './rate-limiter'

const logger = createScopedLogger('mcp-test-tool')

// Tolerant ajv — same posture as the tool adapter (never brick on an exotic schema).
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false })

export type TestMcpToolResult =
  | {
      ok: true
      /** The tool itself reported an error result (`isError`), as opposed to a transport failure. */
      isError: boolean
      text: string
      structuredContent?: unknown
      durationMs: number
      /** Single-sample schema inferred from the result — seeds the "Generate from result" editor. */
      inferredSchema?: JsonSchema
    }
  | {
      ok: false
      error: string
      code:
        | 'unknown_tool'
        | 'invalid_args'
        | 'rate_limited'
        | 'auth'
        | 'server_unavailable'
        | 'error'
    }

/**
 * Run one MCP tool with admin-supplied args and return its result. Resolves the server from the
 * org cache (the same snapshot the adapter uses), enforces the org-minute rate ceiling with a
 * synthetic per-click turn id, validates args against the tool's `inputSchema`, and maps auth
 * failures to a reconnect message (flagging the connection). Never throws — all failures are
 * returned as `{ ok: false }`.
 */
export async function testMcpTool(opts: {
  organizationId: string
  userId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
}): Promise<TestMcpToolResult> {
  const { organizationId, userId, serverId, toolName, args } = opts

  const servers = await getOrgCache().get(organizationId, 'mcpServers')
  const server = servers.find((s) => s.serverId === serverId)
  const tool = server?.tools.find((t) => t.name === toolName)
  if (!server || !tool) {
    return { ok: false, code: 'unknown_tool', error: `Tool ${toolName} not found on this server.` }
  }

  const startedAt = Date.now()
  const logCall = (success: boolean, errorCode?: string) =>
    logger.info('mcp.tool_call', {
      server: server.slug,
      tool: toolName,
      durationMs: Date.now() - startedAt,
      success,
      test: true,
      ...(errorCode ? { errorCode } : {}),
    })

  // Validate args (tolerant: an uncompilable schema skips validation rather than blocking the run).
  try {
    const validate = ajv.compile(tool.inputSchema)
    if (!validate(args)) {
      logCall(false, 'invalid_args')
      return {
        ok: false,
        code: 'invalid_args',
        error: `Invalid arguments: ${ajv.errorsText(validate.errors, { separator: '; ' })}`,
      }
    }
  } catch {
    // nonstandard schema → run anyway.
  }

  // Org-minute ceiling still applies; the per-click "turn" makes the per-turn budget effectively 1.
  const rate = await checkAndCountMcpCall({ organizationId, turnId: `test:${serverId}:${userId}` })
  if (!rate.allowed) {
    logCall(false, `rate_limited:${rate.reason}`)
    return {
      ok: false,
      code: 'rate_limited',
      error: `MCP rate limit reached (${rate.reason}); try again later.`,
    }
  }

  const ctxResult = await buildMcpRequestContext({ mcpServerId: serverId, organizationId })
  if (ctxResult.isErr()) {
    logCall(false, 'context_unavailable')
    return { ok: false, code: 'server_unavailable', error: ctxResult.error.message }
  }

  try {
    const result = await mcpCallTool(
      { endpoint: ctxResult.value.endpoint, headers: ctxResult.value.headers },
      toolName,
      args
    )
    logCall(!result.isError, result.isError ? 'tool_error' : undefined)
    return {
      ok: true,
      isError: result.isError,
      text: result.text,
      structuredContent: result.structuredContent,
      durationMs: Date.now() - startedAt,
      inferredSchema: inferResultSchema(result),
    }
  } catch (error) {
    if (error instanceof McpAuthError) {
      void markMcpConnectionFailed({ mcpServerId: serverId, organizationId })
      logCall(false, 'auth')
      return {
        ok: false,
        code: 'auth',
        error: 'MCP server auth failed — an admin may need to reconnect.',
      }
    }
    const mapped = mapMcpError(error)
    logCall(false, mapped.code)
    return { ok: false, code: 'error', error: mapped.message }
  }
}

/**
 * Infer a result schema for the editor. Prefer the typed `structuredContent`; otherwise parse the
 * text as JSON; if it isn't JSON, describe it as a plain string.
 */
function inferResultSchema(result: { text: string; structuredContent?: unknown }): JsonSchema {
  if (result.structuredContent !== undefined) return inferJsonSchema(result.structuredContent)
  try {
    return inferJsonSchema(JSON.parse(result.text))
  } catch {
    return { type: 'string' }
  }
}

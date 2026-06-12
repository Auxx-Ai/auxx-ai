// packages/lib/src/ai/mcp/tool-adapter.ts

import { createScopedLogger } from '@auxx/logger'
import Ajv, { type ValidateFunction } from 'ajv'
// Shared, client-safe `mcpToolName` so the builder catalog and the runtime register
// identical names (disable-lists must match exactly).
import { mcpToolName } from '../../agents/client'
import type { AgentToolDefinition } from '../agent-framework/types'
import { buildMcpRequestContext } from './auth'
import { mcpCallTool } from './client'
import { markMcpConnectionFailed } from './connections'
import { McpAuthError, mapMcpError } from './errors'
import { checkAndCountMcpCall } from './rate-limiter'
import type { CachedMcpServer } from './types'

export { mcpToolName }

const logger = createScopedLogger('mcp-tool-adapter')

// Ajv tolerant of nonstandard MCP schemas — never brick a tool on an exotic schema.
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false })

/** Wrap MCP tool output in a prompt-injection boundary the model is told to treat as data. */
export function wrapMcpOutput(serverSlug: string, toolName: string, text: string): string {
  return `<mcp_tool_output server="${serverSlug}" tool="${toolName}">\n${text}\n</mcp_tool_output>`
}

type CachedTool = CachedMcpServer['tools'][number]

/**
 * Build `AgentToolDefinition`s for one connected MCP server's snapshot.
 *
 * - Autonomous runs drop untrusted non-readOnly tools (wiring + explicit trust = authorization).
 * - `requiresApproval` = not readOnly and not trusted.
 * - `validateInputs` lazily compiles ajv against the tool's inputSchema; an uncompilable schema
 *   means "no validation" rather than a dead tool.
 * - `execute` enforces the per-turn/org rate limit, calls the tool, wraps output, and maps errors
 *   to tool-result failures (never throws); a 401 also flags the connection for reconnect.
 */
export function buildMcpAgentTools(opts: {
  server: CachedMcpServer
  autonomous: boolean
}): AgentToolDefinition[] {
  const { server, autonomous } = opts
  const defs: AgentToolDefinition[] = []

  for (const tool of server.tools) {
    if (autonomous && !tool.readOnlyHint && !tool.trusted) continue
    defs.push(buildOne(server, tool))
  }
  return defs
}

function buildOne(server: CachedMcpServer, tool: CachedTool): AgentToolDefinition {
  const name = mcpToolName(server.slug, tool.name)
  const requiresApproval = !tool.readOnlyHint && !tool.trusted

  // Compile the validator lazily once, cached on this closure.
  let validator: ValidateFunction | null | undefined
  const getValidator = (): ValidateFunction | null => {
    if (validator !== undefined) return validator
    try {
      validator = ajv.compile(tool.inputSchema)
    } catch {
      validator = null // nonstandard schema → skip validation rather than brick the tool
    }
    return validator
  }

  return {
    name,
    displayName: tool.title ?? tool.name,
    description: `${tool.description ?? tool.name}\n(via ${server.name} MCP server)`,
    parameters: tool.inputSchema,
    requiresApproval,
    toolsetSlug: server.toolsetSlug,
    validateInputs: async (args) => {
      const v = getValidator()
      if (!v) return { ok: true, args }
      if (v(args)) return { ok: true, args }
      const message = ajv.errorsText(v.errors, { separator: '; ' })
      return { ok: false, error: `Invalid arguments: ${message}` }
    },
    // Capture/eval runs never hit the network for approval-gated tools.
    captureMint: () => ({ _mcpStub: true, server: server.slug, tool: tool.name }),
    buildDigest: (output) => ({
      server: server.name,
      tool: tool.name,
      preview: typeof output === 'string' ? output.slice(0, 200) : undefined,
    }),
    execute: async (args, ctx) => {
      // Per-call telemetry — server/tool/duration/outcome only. Never args, results, or tokens.
      const startedAt = Date.now()
      const logCall = (success: boolean, errorCode?: string) =>
        logger.info('mcp.tool_call', {
          server: server.slug,
          tool: tool.name,
          durationMs: Date.now() - startedAt,
          success,
          ...(errorCode ? { errorCode } : {}),
        })

      const rate = await checkAndCountMcpCall({
        organizationId: ctx.organizationId,
        turnId: ctx.turnId,
      })
      if (!rate.allowed) {
        logCall(false, `rate_limited:${rate.reason}`)
        return {
          success: false,
          output: null,
          error: `MCP rate limit reached (${rate.reason}); try later.`,
        }
      }

      const ctxResult = await buildMcpRequestContext({
        mcpServerId: server.serverId,
        organizationId: ctx.organizationId,
      })
      if (ctxResult.isErr()) {
        logCall(false, 'context_unavailable')
        return { success: false, output: null, error: ctxResult.error.message }
      }

      try {
        const result = await mcpCallTool(
          { endpoint: ctxResult.value.endpoint, headers: ctxResult.value.headers },
          tool.name,
          args
        )
        // When the server returns a typed result, the serialized JSON is the canonical
        // model-facing string (per spec the text block SHOULD already be this JSON).
        const body =
          result.structuredContent !== undefined
            ? JSON.stringify(result.structuredContent, null, 2)
            : result.text
        if (result.isError) {
          logCall(false, 'tool_error')
          return {
            success: false,
            output: null,
            error: wrapMcpOutput(server.slug, tool.name, body),
          }
        }
        logCall(true)
        return {
          success: true,
          output: wrapMcpOutput(server.slug, tool.name, body),
        }
      } catch (error) {
        const mapped = mapMcpError(error)
        if (error instanceof McpAuthError) {
          // Fire-and-forget: flag the connection so the settings UI shows "reconnect".
          void markMcpConnectionFailed({
            mcpServerId: server.serverId,
            organizationId: ctx.organizationId,
          })
          logCall(false, 'auth')
          return {
            success: false,
            output: null,
            error: 'MCP server auth failed — an admin may need to reconnect.',
          }
        }
        logCall(false, mapped.code)
        logger.warn('MCP tool execute failed', { server: server.slug, tool: tool.name, mapped })
        return { success: false, output: null, error: mapped.message }
      }
    },
  }
}

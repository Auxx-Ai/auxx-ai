// packages/lib/src/ai/mcp/tool-adapter.ts

import { createScopedLogger } from '@auxx/logger'
import Ajv, { type ValidateFunction } from 'ajv'
// Shared, client-safe `mcpToolName` so the builder catalog and the runtime register
// identical names (disable-lists must match exactly).
import { mcpToolName } from '../../agents/client'
import type { AgentToolDefinition } from '../agent-framework/types'
// The injection-boundary fence now lives at the wire layer (`partsToWireFormat`):
// the adapter returns raw, walkable output and the boundary is re-applied on
// model replay. Re-exported here for the MCP barrel + tests.
import { wrapMcpOutput } from '../agent-framework/utils'
import { callMcpToolWithAuthRetry } from './call-with-auth-retry'
import { mapMcpError } from './errors'
import { checkAndCountMcpCall } from './rate-limiter'
import type { CachedMcpServer } from './types'

export { mcpToolName, wrapMcpOutput }

const logger = createScopedLogger('mcp-tool-adapter')

// Ajv tolerant of nonstandard MCP schemas — never brick a tool on an exotic schema.
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false })

type CachedTool = CachedMcpServer['tools'][number]

/**
 * Parse MCP text output into a structured value when it is a JSON object/array;
 * otherwise return `undefined` so the caller falls back to the raw string. Only
 * objects/arrays are walkable (`tool:<name>.path`); scalars stay strings.
 */
function tryParseJson(text: string): Record<string, unknown> | unknown[] | undefined {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object'
      ? (value as Record<string, unknown> | unknown[])
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Build `AgentToolDefinition`s for one connected MCP server's snapshot.
 *
 * - Autonomous runs drop untrusted non-readOnly tools (wiring + explicit trust = authorization).
 * - `requiresApproval` = not readOnly and not trusted.
 * - `validateInputs` lazily compiles ajv against the tool's inputSchema; an uncompilable schema
 *   means "no validation" rather than a dead tool.
 * - `execute` enforces the per-turn/org rate limit, calls the tool, returns the structured
 *   (walkable) output, and maps errors to tool-result failures (never throws); a 401 also flags the
 *   connection for reconnect. The prompt-injection boundary is re-applied at the wire layer via the
 *   `outputBoundary` marker — see `partsToWireFormat`.
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
    // An MCP tool's effects live on an external server, so nothing here maps to
    // an area / definition / instance level (plan 19 §11.8). Its authorization is
    // the two-flag trust model on the server snapshot: autonomous runs drop
    // untrusted non-read-only tools (above), `requiresApproval` is
    // `!readOnlyHint && !trusted`, and output is fenced as untrusted external
    // data. Marked `bridge` (never `none`) so the audit can tell
    // "unclassifiable" from "verified to need nothing".
    permission: {
      target: 'bridge',
      governedBy: 'mcp',
      note: 'External MCP server: org-set `trusted` + server-declared `readOnlyHint` drive the autonomous drop and the approval gate. No platform-level target exists.',
    },
    displayName: tool.title ?? tool.name,
    description: `${tool.description ?? tool.name}\n(via ${server.name} MCP server)`,
    parameters: tool.inputSchema,
    // The stored result schema (server/inferred/manual) as the JSON-Schema read
    // currency for the discoverability / binding surface. One line, no conversion.
    ...(tool.outputSchema ? { outputsJsonSchema: tool.outputSchema } : {}),
    // Marks this tool's output as untrusted external data: the wire layer fences
    // it for model replay while the stored value stays raw and walkable.
    outputBoundary: { server: server.slug, tool: tool.name },
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
      preview:
        typeof output === 'string'
          ? output.slice(0, 200)
          : output != null
            ? JSON.stringify(output).slice(0, 200)
            : undefined,
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

      // Handles context build, the call, and 401 refresh-and-retry; an unrecoverable
      // auth failure is already flagged for reconnect when it comes back here.
      const outcome = await callMcpToolWithAuthRetry({
        mcpServerId: server.serverId,
        organizationId: ctx.organizationId,
        toolName: tool.name,
        args,
      })

      if (!outcome.ok) {
        if (outcome.kind === 'context') {
          logCall(false, 'context_unavailable')
          return { success: false, output: null, error: outcome.message }
        }
        if (outcome.kind === 'auth') {
          logCall(false, 'auth')
          return { success: false, output: null, error: outcome.message }
        }
        const mapped = mapMcpError(outcome.error)
        logCall(false, mapped.code)
        logger.warn('MCP tool execute failed', { server: server.slug, tool: tool.name, mapped })
        return { success: false, output: null, error: mapped.message }
      }

      const result = outcome.result
      // Return the structured value (or parsed JSON text) so `tool:<name>.path`
      // resolves at runtime; the injection boundary is re-applied at the wire
      // layer from the tool's `outputBoundary` marker. Genuinely textual tools
      // stay a scalar string — correct, just not walkable.
      const value =
        result.structuredContent !== undefined
          ? result.structuredContent
          : (tryParseJson(result.text) ?? result.text)
      if (result.isError) {
        logCall(false, 'tool_error')
        // Keep the structured value on `output` (still wire-fenced) and a
        // human-readable error string alongside it.
        return { success: false, output: value, error: result.text }
      }
      logCall(true)
      return { success: true, output: value }
    },
  }
}

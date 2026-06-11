// packages/lib/src/ai/mcp/rate-limiter.ts

import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'

/** Max MCP tool calls per agent turn. */
export const MCP_TURN_CALL_LIMIT = 20
/** TTL of the per-turn counter (covers a long-running turn). */
export const MCP_TURN_TTL_SECONDS = 15 * 60
/** Max MCP tool calls per org per minute bucket. */
export const MCP_ORG_CALL_LIMIT = 500
/** TTL of the per-org minute bucket. */
export const MCP_ORG_TTL_SECONDS = 120

export interface McpRateLimitResult {
  allowed: boolean
  reason?: 'turn' | 'org'
}

/** Max smart-paste snippet resolutions per org per minute (each makes outbound fetches). */
export const MCP_RESOLVE_LIMIT = 10
const MCP_RESOLVE_TTL_SECONDS = 120

/**
 * Per-org-minute limit for `mcp.resolveSnippet`. Fails open if Redis is down.
 * Returns false when the org is over the limit for the current minute bucket.
 */
export async function checkMcpResolveRateLimit(organizationId: string): Promise<boolean> {
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const { allowed } = await checkFixedWindowLimit({
    key: `mcp:resolve:${organizationId}:${minuteBucket}`,
    limit: MCP_RESOLVE_LIMIT,
    windowMs: MCP_RESOLVE_TTL_SECONDS * 1000,
  })
  return allowed
}

/**
 * Counts the call against the per-turn and per-org-minute MCP limits. Fails open if
 * Redis is down (an MCP call should not be blocked by a cache outage). Enforced by
 * the tool adapter.
 */
export async function checkAndCountMcpCall(opts: {
  organizationId: string
  turnId?: string
}): Promise<McpRateLimitResult> {
  if (opts.turnId) {
    const turn = await checkFixedWindowLimit({
      key: `mcp:calls:turn:${opts.turnId}`,
      limit: MCP_TURN_CALL_LIMIT,
      windowMs: MCP_TURN_TTL_SECONDS * 1000,
    })
    if (!turn.allowed) return { allowed: false, reason: 'turn' }
  }

  const minuteBucket = Math.floor(Date.now() / 60_000)
  const org = await checkFixedWindowLimit({
    key: `mcp:calls:org:${opts.organizationId}:${minuteBucket}`,
    limit: MCP_ORG_CALL_LIMIT,
    windowMs: MCP_ORG_TTL_SECONDS * 1000,
  })
  if (!org.allowed) return { allowed: false, reason: 'org' }

  return { allowed: true }
}

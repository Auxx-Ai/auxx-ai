// packages/lib/src/ai/mcp/rate-limiter.ts

import { getRedisClient } from '@auxx/redis'

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

/**
 * INCR + EXPIRE per-turn and per-org-minute MCP call counters. Fails open if Redis is down
 * (an MCP call should not be blocked by a cache outage). Enforced by the tool adapter.
 */
export async function checkAndCountMcpCall(opts: {
  organizationId: string
  turnId?: string
}): Promise<McpRateLimitResult> {
  const redis = await getRedisClient(false)
  if (!redis) return { allowed: true }

  try {
    if (opts.turnId) {
      const turnKey = `mcp:calls:turn:${opts.turnId}`
      const turnCount = await redis.incr(turnKey)
      if (turnCount === 1) await redis.expire(turnKey, MCP_TURN_TTL_SECONDS)
      if (turnCount > MCP_TURN_CALL_LIMIT) return { allowed: false, reason: 'turn' }
    }

    const minuteBucket = Math.floor(Date.now() / 60_000)
    const orgKey = `mcp:calls:org:${opts.organizationId}:${minuteBucket}`
    const orgCount = await redis.incr(orgKey)
    if (orgCount === 1) await redis.expire(orgKey, MCP_ORG_TTL_SECONDS)
    if (orgCount > MCP_ORG_CALL_LIMIT) return { allowed: false, reason: 'org' }

    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}

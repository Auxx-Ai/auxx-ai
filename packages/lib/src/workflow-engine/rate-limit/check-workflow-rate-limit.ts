// packages/lib/src/workflow-engine/rate-limit/check-workflow-rate-limit.ts

import { ok, type Result } from 'neverthrow'
import { getRedisClient } from '@auxx/redis'

/**
 * Rate limit configuration
 */
export interface WorkflowRateLimitConfig {
  enabled: boolean
  maxRequests: number
  windowMs: number
  perUser?: boolean
}

/**
 * Options for rate limit check
 */
export interface CheckWorkflowRateLimitOptions {
  workflowAppId: string
  endUserId: string
  rateLimit: WorkflowRateLimitConfig | null
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  isLimited: boolean
  current: number
  limit: number
  remainingMs?: number
}

/**
 * Check if workflow run should be rate limited
 *
 * @param options - Rate limit options
 * @returns Result with rate limit status
 */
export async function checkWorkflowRateLimit(
  options: CheckWorkflowRateLimitOptions
): Promise<Result<RateLimitCheckResult, never>> {
  const { workflowAppId, endUserId, rateLimit } = options

  // If rate limiting is not configured or disabled, allow
  if (!rateLimit || !rateLimit.enabled) {
    return ok({
      isLimited: false,
      current: 0,
      limit: Infinity,
    })
  }

  const key = rateLimit.perUser
    ? `ratelimit:workflow:${workflowAppId}:${endUserId}`
    : `ratelimit:workflow:${workflowAppId}`

  try {
    const redis = getRedisClient()
    const current = await redis.incr(key)

    if (current === 1) {
      // First request in window, set expiry
      await redis.pexpire(key, rateLimit.windowMs)
    }

    const isLimited = current > rateLimit.maxRequests

    let remainingMs: number | undefined
    if (isLimited) {
      remainingMs = await redis.pttl(key)
    }

    return ok({
      isLimited,
      current,
      limit: rateLimit.maxRequests,
      remainingMs,
    })
  } catch {
    // If Redis fails, allow the request (fail open)
    return ok({
      isLimited: false,
      current: 0,
      limit: rateLimit.maxRequests,
    })
  }
}

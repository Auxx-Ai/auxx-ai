// packages/lib/src/workflow-engine/rate-limit/check-workflow-rate-limit.ts

import { ok, type Result } from 'neverthrow'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'

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
 * Check if workflow run should be rate limited. Fails open when Redis is unavailable.
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

  const result = await checkFixedWindowLimit({
    key,
    limit: rateLimit.maxRequests,
    windowMs: rateLimit.windowMs,
  })

  return ok({
    isLimited: !result.allowed,
    current: result.count,
    limit: rateLimit.maxRequests,
    remainingMs: result.remainingMs,
  })
}

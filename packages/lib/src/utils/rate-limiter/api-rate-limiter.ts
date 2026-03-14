// packages/lib/src/utils/rate-limiter/api-rate-limiter.ts

import { RedisRateLimiter } from './redis-rate-limiter'
import type { RateLimiterConfig } from './types'

/** Singleton cache of rate limiters by name */
const limiters = new Map<string, RedisRateLimiter>()

/**
 * Get or create a named rate limiter instance.
 * Instances are cached as singletons to share Redis connections.
 */
export function getApiRateLimiter(config: RateLimiterConfig): RedisRateLimiter {
  const name = config.name || `api:${config.maxRequests}:${config.perInterval}`
  if (!limiters.has(name)) {
    limiters.set(name, new RedisRateLimiter(config))
  }
  return limiters.get(name)!
}

/**
 * Extract client IP from a Web API Request object (Next.js, Hono, etc.)
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]!.trim()
  }
  return request.headers.get('x-real-ip') || 'unknown'
}

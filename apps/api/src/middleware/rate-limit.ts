// apps/api/src/middleware/rate-limit.ts

import { getApiRateLimiter } from '@auxx/lib/utils/rate-limiter'
import { createScopedLogger } from '@auxx/logger'
import type { Context, MiddlewareHandler } from 'hono'

const log = createScopedLogger('rate-limit-middleware')

export interface RateLimitRule {
  /** Stable name; cached limiter instance + Redis bucket prefix. */
  name: string
  maxRequests: number
  perInterval: number
  /** Restrict the rule to specific HTTP methods. Default: any method except OPTIONS. */
  methods?: string[]
  /** Build the bucket key from the request. Return null to skip this rule. */
  key: (c: Context) => string | null
}

/**
 * Compose any number of {@link RateLimitRule}s into a Hono middleware. All
 * rules must pass; the first one to reject returns 429. Mount this after any
 * middleware that populates the context the keys read (e.g. chatPassportMiddleware).
 */
export function rateLimit(rules: RateLimitRule[]): MiddlewareHandler {
  const limiters = rules.map((rule) => ({
    rule,
    limiter: getApiRateLimiter({
      name: rule.name,
      maxRequests: rule.maxRequests,
      perInterval: rule.perInterval,
    }),
  }))

  return async (c, next) => {
    // Preflight requests carry no auth and no body; rate-limiting them just
    // breaks CORS for legitimate clients sitting behind a shared proxy IP.
    if (c.req.method === 'OPTIONS') return next()

    for (const { rule, limiter } of limiters) {
      if (rule.methods && !rule.methods.includes(c.req.method)) continue
      const key = rule.key(c)
      if (!key) continue
      const ok = await limiter.acquire(`${rule.name}:${key}`)
      if (!ok) {
        log.warn('Rate limit exceeded', { name: rule.name, key })
        return c.json(
          { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
          429
        )
      }
    }
    return next()
  }
}

/** Per-IP key derived from `x-forwarded-for` / `x-real-ip`. Falls back to `unknown`. */
export const ipKey = (c: Context): string =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'

/** Per-widget key from the verified chat passport. Null when not set. */
export const channelKey = (c: Context): string | null => {
  const chat = c.get('chat')
  return chat?.channelId ?? null
}

/**
 * Per-thread key scoped to the visitor that hit it, so a known threadId can't
 * be used to drain another visitor's bucket from the outside. Reads threadId
 * from the URL path — body parsing is intentionally avoided here.
 */
export const visitorThreadKey = (c: Context): string | null => {
  const threadId = c.req.param('threadId')
  if (!threadId) return null
  const chat = c.get('chat')
  return chat?.visitorParticipantId ? `${chat.visitorParticipantId}:${threadId}` : threadId
}

// packages/lib/src/usage/usage-counter.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RedisClient } from '@auxx/redis'
import { and, eq, sql } from 'drizzle-orm'
import type { RecordUsageEventJobData } from './types'

const logger = createScopedLogger('usage-counter')

export class UsageCounter {
  constructor(
    private redis: RedisClient,
    private db: Database
  ) {}

  /**
   * Returns a calendar month key like '2026-03'.
   * Usage windows are always monthly regardless of billing cycle.
   */
  getMonthKey(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  /**
   * Atomic increment-then-check using INCRBY.
   *
   * Pattern: optimistic increment, rollback if over limit.
   *   1. INCRBY key quantity → returns new total (atomic)
   *   2. If new total > limit → DECRBY to rollback, return denied
   *   3. If new total <= limit → allowed, set TTL if needed
   *
   * Race safety: INCRBY is atomic in Redis. Two concurrent requests
   * both increment, both see their post-increment value. At most one
   * can be under the limit — the other sees it exceeded and rolls back.
   */
  async consumeIfAllowed(params: {
    orgId: string
    metric: string
    hardLimit: number // -1 = unlimited
    quantity?: number
    userId?: string
    metadata?: Record<string, unknown>
  }): Promise<{ allowed: boolean; current: number }> {
    const periodKey = this.getMonthKey()
    const redisKey = `usage:${params.orgId}:${params.metric}:${periodKey}`
    const quantity = params.quantity ?? 1
    const hardLimit = params.hardLimit

    // Unlimited — just increment, no limit check
    if (hardLimit === -1) {
      const newTotal = await this.redis.incrby(redisKey, quantity)
      if (newTotal === quantity) {
        await this.redis.expire(redisKey, this.getMonthTTL())
      }
      this.enqueueRecordEvent(params, periodKey, quantity)
      return { allowed: true, current: newTotal }
    }

    // Optimistic increment — INCRBY is atomic, returns new total
    const newTotal = await this.redis.incrby(redisKey, quantity)

    // Check if we exceeded the limit
    if (newTotal > hardLimit) {
      // Rollback
      await this.redis.decrby(redisKey, quantity)
      return { allowed: false, current: newTotal - quantity }
    }

    // Set TTL on first write
    if (newTotal === quantity) {
      await this.redis.expire(redisKey, this.getMonthTTL())
    }

    // Allowed — record event async via BullMQ
    this.enqueueRecordEvent(params, periodKey, quantity)

    return { allowed: true, current: newTotal }
  }

  /**
   * Get current usage for a metric in the current month.
   * Falls back to Postgres if Redis key is missing (eviction/restart).
   */
  async getCurrentUsage(orgId: string, metric: string): Promise<number> {
    const periodKey = this.getMonthKey()
    const redisKey = `usage:${orgId}:${metric}:${periodKey}`

    // Try Redis first
    const redisValue = await this.redis.get(redisKey)
    if (redisValue !== null && redisValue !== undefined) {
      return Number.parseInt(String(redisValue), 10)
    }

    // Redis miss — rebuild from Postgres
    const pgCount = await this.rebuildFromPostgres(orgId, metric, periodKey)

    // Re-seed Redis
    if (pgCount > 0) {
      await this.redis.set(redisKey, String(pgCount), 'EX', this.getMonthTTL())
    }

    return pgCount
  }

  /**
   * Rebuild a Redis counter from the Postgres UsageEvent table.
   * Called on cache miss (Redis restart, eviction, or first read after deploy).
   */
  private async rebuildFromPostgres(
    orgId: string,
    metric: string,
    periodKey: string
  ): Promise<number> {
    try {
      const [result] = await this.db
        .select({
          total: sql<number>`coalesce(sum(${schema.UsageEvent.quantity}), 0)`,
        })
        .from(schema.UsageEvent)
        .where(
          and(
            eq(schema.UsageEvent.organizationId, orgId),
            eq(schema.UsageEvent.metric, metric),
            eq(schema.UsageEvent.periodKey, periodKey)
          )
        )

      return result?.total ?? 0
    } catch (error) {
      logger.error('Failed to rebuild usage from Postgres', {
        orgId,
        metric,
        periodKey,
        error: (error as Error).message,
      })
      return 0
    }
  }

  /** Fire-and-forget: record usage event to Postgres via BullMQ */
  private enqueueRecordEvent(
    params: {
      orgId: string
      metric: string
      userId?: string
      metadata?: Record<string, unknown>
    },
    periodKey: string,
    quantity: number
  ) {
    const data: RecordUsageEventJobData = {
      orgId: params.orgId,
      metric: params.metric,
      quantity,
      userId: params.userId,
      metadata: params.metadata,
      periodKey,
      timestamp: Date.now(),
    }

    // Lazy import to avoid circular deps
    import('./enqueue-usage-event').then((mod) => mod.enqueueUsageEvent(data)).catch(() => {}) // Don't fail the action if queue is down
  }

  /** TTL in seconds until end of current month + 7 day buffer */
  private getMonthTTL(): number {
    const now = new Date()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const remainingSeconds = Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000)
    return remainingSeconds + 7 * 24 * 60 * 60 // +7 days buffer
  }
}

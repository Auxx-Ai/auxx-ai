// packages/lib/src/usage/usage-guard.ts

import { createScopedLogger } from '@auxx/logger'
import type { FeaturePermissionService } from '../permissions/feature-permission-service'
import type { FeatureKey, FeatureLimit } from '../permissions/types'
import type { UsageMetric, UsageResult, UsageStatus } from './types'
import type { UsageCounter } from './usage-counter'

const logger = createScopedLogger('usage-guard')

export class UsageGuard {
  constructor(
    private featureService: FeaturePermissionService,
    private counter: UsageCounter
  ) {}

  /**
   * Check if action is allowed and record it atomically.
   *
   * @example
   * const result = await usageGuard.consume(orgId, 'outboundEmails', { userId })
   * if (!result.allowed) throw new RateLimitError(result.message)
   */
  async consume(
    orgId: string,
    metric: UsageMetric,
    opts?: {
      quantity?: number
      userId?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<UsageResult> {
    const hardKey = `${metric}PerMonthHard` as FeatureKey
    const softKey = `${metric}PerMonthSoft` as FeatureKey

    // Get limits from plan (already Redis-cached by FeaturePermissionService)
    const hardLimit = await this.featureService.getLimit(orgId, hardKey)
    const softLimit = await this.featureService.getLimit(orgId, softKey)

    // No access (feature not in plan, or explicitly false/0)
    if (hardLimit === null || hardLimit === false || hardLimit === 0) {
      return { allowed: false, reason: 'featureNotAvailable', upgradeRequired: true }
    }

    // Resolve '+' back to -1 for the counter (which uses -1 for unlimited)
    const numericHardLimit = this.toNumericLimit(hardLimit)

    // Atomic increment-then-check
    const { allowed, current } = await this.counter.consumeIfAllowed({
      orgId,
      metric,
      hardLimit: numericHardLimit,
      quantity: opts?.quantity,
      userId: opts?.userId,
      metadata: opts?.metadata,
    })

    if (!allowed) {
      return {
        allowed: false,
        reason: 'hardLimitReached',
        current,
        limit: numericHardLimit,
        upgradeRequired: true,
      }
    }

    // Check soft limit (warn but allow — already incremented)
    const numericSoftLimit = this.toNumericLimit(softLimit)
    const atSoftLimit = numericSoftLimit > 0 && current >= numericSoftLimit
    if (atSoftLimit) {
      logger.info('Soft limit reached', { orgId, metric, current, softLimit: numericSoftLimit })
    }

    return {
      allowed: true,
      current,
      limit: numericHardLimit === -1 ? undefined : numericHardLimit,
      unlimited: numericHardLimit === -1,
      softLimitReached: atSoftLimit,
    }
  }

  /**
   * Check usage without consuming. Useful for UI display.
   */
  async check(orgId: string, metric: UsageMetric): Promise<UsageStatus> {
    const hardKey = `${metric}PerMonthHard` as FeatureKey
    const softKey = `${metric}PerMonthSoft` as FeatureKey

    const [hardLimit, softLimit, current] = await Promise.all([
      this.featureService.getLimit(orgId, hardKey),
      this.featureService.getLimit(orgId, softKey),
      this.counter.getCurrentUsage(orgId, metric),
    ])

    const numericHard = this.toNumericLimit(hardLimit)
    const numericSoft = this.toNumericLimit(softLimit)

    return {
      metric,
      current,
      hardLimit: numericHard,
      softLimit: numericSoft,
      unlimited: numericHard === -1,
      percentUsed: numericHard > 0 ? Math.round((current / numericHard) * 100) : 0,
    }
  }

  /** Convert FeatureLimit to numeric: '+'/true → -1, null/false → 0, number stays */
  private toNumericLimit(limit: FeatureLimit | null): number {
    if (limit === '+' || limit === true) return -1
    if (limit === null || limit === false) return 0
    return limit as number
  }
}

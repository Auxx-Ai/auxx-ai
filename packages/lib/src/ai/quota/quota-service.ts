// packages/lib/src/ai/quota/quota-service.ts

import { type Database, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { eq, sql } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../providers/types'

const logger = createScopedLogger('quota-service')

/** A month later than `from`. */
function addOneMonth(from: Date): Date {
  const end = new Date(from)
  end.setMonth(end.getMonth() + 1)
  return end
}

export interface QuotaStatus {
  quotaType: ProviderQuotaType
  /** Credits spent from the monthly allowance this cycle. */
  quotaUsed: number
  /** Monthly allowance from the active plan. -1 = unlimited. */
  quotaLimit: number
  /** Admin-granted bonus pool. Not reset by billing cycle. */
  bonusCredits: number
  /** Remaining monthly credits. 0 when exhausted; `Infinity` when unlimited. */
  monthlyRemaining: number
  /** Total effective credits left: monthlyRemaining + bonusCredits. */
  totalRemaining: number
  quotaPeriodStart: Date | null
  quotaPeriodEnd: Date | null
  percentUsed: number
  /** Both monthly and bonus pools are empty. */
  isExceeded: boolean
}

/**
 * Service for managing AI provider quotas at org level.
 * Handles quota upgrades, downgrades, trial initialization, billing-cycle resets,
 * and the two-pool spend order: monthly allowance first, then `creditsBalance` bonus pool.
 */
export class QuotaService {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Upgrade organization to paid tier with specified credit limit.
   * Called from Stripe `invoice.paid` / `subscription.updated` webhooks.
   * Resets `quotaUsed` and the period window. Does NOT touch `creditsBalance`.
   */
  async upgradeToPaid(creditLimit: number): Promise<void> {
    logger.info('Upgrading organization to paid tier', {
      organizationId: this.organizationId,
      creditLimit,
    })
    await this.writeQuota({
      quotaType: ProviderQuotaType.PAID,
      quotaLimit: creditLimit,
      quotaUsed: 0,
      resetPeriod: true,
    })
  }

  /**
   * Downgrade organization to free tier. Resets used + period, keeps bonus credits.
   */
  async downgradeToFree(): Promise<void> {
    logger.info('Downgrading organization to free tier', { organizationId: this.organizationId })
    await this.writeQuota({
      quotaType: ProviderQuotaType.FREE,
      quotaLimit: DEFAULT_QUOTA_LIMITS[ProviderQuotaType.FREE],
      quotaUsed: 0,
      resetPeriod: true,
    })
  }

  /**
   * Reset quota for a new billing cycle. Keeps `quotaLimit` and `quotaType`;
   * zeros `quotaUsed` and advances the period window by one month.
   */
  async resetQuota(): Promise<void> {
    logger.info('Resetting quota for organization', { organizationId: this.organizationId })
    const row = await this.loadRow()
    if (!row) {
      logger.warn('resetQuota called but no quota row exists', {
        organizationId: this.organizationId,
      })
      return
    }
    const now = new Date()
    await this.db
      .update(schema.OrganizationAiQuota)
      .set({
        quotaUsed: 0,
        quotaPeriodStart: now,
        quotaPeriodEnd: addOneMonth(now),
      })
      .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))
  }

  /**
   * Pro-rate quota on plan change mid-cycle.
   * Upgrades keep `used` as-is on the bigger pool. Downgrades scale `used`
   * up by the portion of the cycle that had already passed on the old plan.
   */
  async proRateQuotaOnPlanChange(oldLimit: number, newLimit: number): Promise<void> {
    const row = await this.loadRow()
    if (!row) return
    if (oldLimit === -1 || newLimit === -1) {
      // Unlimited on either side: just set the new limit.
      await this.db
        .update(schema.OrganizationAiQuota)
        .set({ quotaLimit: newLimit })
        .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))
      return
    }

    let newUsed = row.quotaUsed
    if (newLimit < oldLimit && row.quotaPeriodStart && row.quotaPeriodEnd) {
      const cycleMs = row.quotaPeriodEnd.getTime() - row.quotaPeriodStart.getTime()
      const elapsedMs = Date.now() - row.quotaPeriodStart.getTime()
      const fraction = cycleMs > 0 ? Math.max(0, Math.min(1, elapsedMs / cycleMs)) : 0
      newUsed = Math.min(newLimit, Math.round(row.quotaUsed + (oldLimit - newLimit) * fraction))
    }

    await this.db
      .update(schema.OrganizationAiQuota)
      .set({
        quotaLimit: newLimit,
        quotaUsed: newUsed,
      })
      .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))

    logger.info('Pro-rated quota on plan change', {
      organizationId: this.organizationId,
      oldLimit,
      newLimit,
      oldUsed: row.quotaUsed,
      newUsed,
    })
  }

  /**
   * Get current quota status (monthly + bonus breakdown).
   * Returns null when the org has no quota row yet.
   */
  async getQuotaStatus(): Promise<QuotaStatus | null> {
    if (isSelfHosted()) {
      return {
        quotaType: ProviderQuotaType.PAID,
        quotaUsed: 0,
        quotaLimit: -1,
        bonusCredits: 0,
        monthlyRemaining: Number.POSITIVE_INFINITY,
        totalRemaining: Number.POSITIVE_INFINITY,
        quotaPeriodStart: null,
        quotaPeriodEnd: null,
        percentUsed: 0,
        isExceeded: false,
      }
    }

    const [row, subscription] = await Promise.all([this.loadRow(), this.loadSubscription()])
    if (!row) return null

    const bonusCredits = Math.max(0, subscription?.creditsBalance ?? 0)
    const quotaUsed = row.quotaUsed
    const quotaLimit = row.quotaLimit
    const isUnlimited = quotaLimit === -1
    const monthlyRemaining = isUnlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(0, quotaLimit - quotaUsed)
    const totalRemaining = isUnlimited ? Number.POSITIVE_INFINITY : monthlyRemaining + bonusCredits
    const percentUsed = isUnlimited || quotaLimit <= 0 ? 0 : (quotaUsed / quotaLimit) * 100

    return {
      quotaType: (row.quotaType as ProviderQuotaType) ?? ProviderQuotaType.FREE,
      quotaUsed,
      quotaLimit,
      bonusCredits,
      monthlyRemaining,
      totalRemaining,
      quotaPeriodStart: row.quotaPeriodStart,
      quotaPeriodEnd: row.quotaPeriodEnd,
      percentUsed: Math.round(percentUsed * 100) / 100,
      isExceeded: !isUnlimited && monthlyRemaining <= 0 && bonusCredits <= 0,
    }
  }

  /**
   * Check if the organization has available quota (monthly OR bonus).
   */
  async hasAvailableQuota(): Promise<boolean> {
    if (isSelfHosted()) return true
    const status = await this.getQuotaStatus()
    if (!status) return false
    return !status.isExceeded
  }

  /**
   * Atomically consume credits from monthly pool first, then bonus pool.
   *
   * Called from `UsageTrackingService.trackUsage` on SYSTEM calls.
   * The amount is `modelMultiplier` — 1/3/8 for small/medium/large tiers.
   *
   * Returns the split between pools for logging/analytics.
   */
  async consumeCredits(amount: number): Promise<{ fromMonthly: number; fromBonus: number }> {
    if (amount <= 0) return { fromMonthly: 0, fromBonus: 0 }
    if (isSelfHosted()) return { fromMonthly: amount, fromBonus: 0 }

    return await this.db.transaction(async (tx) => {
      // Row-lock the quota row for the duration of the transaction so concurrent
      // consumeCredits calls for the same org serialize on the monthly/bonus
      // decision instead of write-skewing each other.
      const [row] = await tx
        .select()
        .from(schema.OrganizationAiQuota)
        .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))
        .for('update')
      if (!row) return { fromMonthly: 0, fromBonus: 0 }

      if (row.quotaLimit === -1) {
        // Unlimited: still increment used for accounting, but do not consume bonus.
        await tx
          .update(schema.OrganizationAiQuota)
          .set({
            quotaUsed: sql`${schema.OrganizationAiQuota.quotaUsed} + ${amount}`,
          })
          .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))
        return { fromMonthly: amount, fromBonus: 0 }
      }

      const monthlyAvailable = Math.max(0, row.quotaLimit - row.quotaUsed)
      const fromMonthly = Math.min(amount, monthlyAvailable)
      const remaining = amount - fromMonthly

      if (fromMonthly > 0) {
        await tx
          .update(schema.OrganizationAiQuota)
          .set({
            quotaUsed: sql`${schema.OrganizationAiQuota.quotaUsed} + ${fromMonthly}`,
          })
          .where(eq(schema.OrganizationAiQuota.organizationId, this.organizationId))
      }

      let fromBonus = 0
      if (remaining > 0) {
        // Spend from bonus pool; floor at 0 (no overdraft).
        const [sub] = await tx
          .select()
          .from(schema.PlanSubscription)
          .where(eq(schema.PlanSubscription.organizationId, this.organizationId))
          .for('update')
        const available = Math.max(0, sub?.creditsBalance ?? 0)
        fromBonus = Math.min(remaining, available)
        if (fromBonus > 0 && sub) {
          await tx
            .update(schema.PlanSubscription)
            .set({
              creditsBalance: sql`${schema.PlanSubscription.creditsBalance} - ${fromBonus}`,
            })
            .where(eq(schema.PlanSubscription.id, sub.id))
        }
      }

      return { fromMonthly, fromBonus }
    })
  }

  // ===== INTERNAL =====

  private async loadRow() {
    return this.db.query.OrganizationAiQuota.findFirst({
      where: eq(schema.OrganizationAiQuota.organizationId, this.organizationId),
    })
  }

  private async loadSubscription() {
    return this.db.query.PlanSubscription.findFirst({
      where: eq(schema.PlanSubscription.organizationId, this.organizationId),
    })
  }

  /**
   * Upsert the OrganizationAiQuota row. If `resetPeriod` is true, the period
   * window is replaced with `[now, now + 1 month]`; otherwise only the other
   * fields are updated.
   */
  private async writeQuota(args: {
    quotaType: ProviderQuotaType
    quotaLimit: number
    quotaUsed: number
    resetPeriod: boolean
  }): Promise<void> {
    const now = new Date()
    const periodEnd = addOneMonth(now)

    await this.db
      .insert(schema.OrganizationAiQuota)
      .values({
        organizationId: this.organizationId,
        quotaType: args.quotaType,
        quotaLimit: args.quotaLimit,
        quotaUsed: args.quotaUsed,
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.OrganizationAiQuota.organizationId,
        set: args.resetPeriod
          ? {
              quotaType: args.quotaType,
              quotaLimit: args.quotaLimit,
              quotaUsed: args.quotaUsed,
              quotaPeriodStart: now,
              quotaPeriodEnd: periodEnd,
              updatedAt: now,
            }
          : {
              quotaType: args.quotaType,
              quotaLimit: args.quotaLimit,
              quotaUsed: args.quotaUsed,
              updatedAt: now,
            },
      })
  }
}

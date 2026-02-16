// packages/lib/src/ai/quota/quota-service.ts

import { type Database, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../providers/types'

const logger = createScopedLogger('quota-service')

/**
 * Service for managing AI provider quotas
 * Handles quota upgrades, downgrades, and trial period management
 */
export class QuotaService {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Upgrade organization to paid tier with specified credit limit
   * @param creditLimit - Credit limit based on subscription plan
   */
  async upgradeToPaid(creditLimit: number): Promise<void> {
    logger.info('Upgrading organization to paid tier', {
      organizationId: this.organizationId,
      creditLimit,
    })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await this.db
      .update(schema.ProviderConfiguration)
      .set({
        quotaType: ProviderQuotaType.PAID,
        quotaLimit: creditLimit,
        quotaUsed: 0, // Reset on upgrade
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
        )
      )

    logger.info('Organization upgraded to paid tier', {
      organizationId: this.organizationId,
      creditLimit,
    })
  }

  /**
   * Downgrade organization to free tier
   * Resets quota to free tier limits
   */
  async downgradeToFree(): Promise<void> {
    logger.info('Downgrading organization to free tier', { organizationId: this.organizationId })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await this.db
      .update(schema.ProviderConfiguration)
      .set({
        quotaType: ProviderQuotaType.FREE,
        quotaLimit: DEFAULT_QUOTA_LIMITS[ProviderQuotaType.FREE],
        quotaUsed: 0,
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
        )
      )

    logger.info('Organization downgraded to free tier', { organizationId: this.organizationId })
  }

  /**
   * Set trial quota for organization
   * @param trialCredits - Number of credits for trial period (default from DEFAULT_QUOTA_LIMITS)
   */
  async setTrialQuota(
    trialCredits: number = DEFAULT_QUOTA_LIMITS[ProviderQuotaType.TRIAL]
  ): Promise<void> {
    logger.info('Setting trial quota', { organizationId: this.organizationId, trialCredits })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await this.db
      .update(schema.ProviderConfiguration)
      .set({
        quotaType: ProviderQuotaType.TRIAL,
        quotaLimit: trialCredits,
        quotaUsed: 0,
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
        )
      )

    logger.info('Trial quota set', { organizationId: this.organizationId, trialCredits })
  }

  /**
   * Get current quota status for the organization
   * @returns Quota information including used, limit, and period details
   */
  async getQuotaStatus(): Promise<{
    quotaType: ProviderQuotaType
    quotaUsed: number
    quotaLimit: number
    quotaPeriodStart: Date | null
    quotaPeriodEnd: Date | null
    percentUsed: number
    isExceeded: boolean
  } | null> {
    // Self-hosted: unlimited quota without DB query
    if (isSelfHosted()) {
      return {
        quotaType: ProviderQuotaType.PAID,
        quotaUsed: 0,
        quotaLimit: -1,
        quotaPeriodStart: null,
        quotaPeriodEnd: null,
        percentUsed: 0,
        isExceeded: false,
      }
    }

    const config = await this.db.query.ProviderConfiguration.findFirst({
      where: and(
        eq(schema.ProviderConfiguration.organizationId, this.organizationId),
        eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
      ),
    })

    if (!config) {
      return null
    }

    const quotaUsed = config.quotaUsed ?? 0
    const quotaLimit = config.quotaLimit ?? DEFAULT_QUOTA_LIMITS[ProviderQuotaType.FREE]
    const percentUsed = quotaLimit > 0 ? (quotaUsed / quotaLimit) * 100 : 0

    return {
      quotaType: (config.quotaType as ProviderQuotaType) ?? ProviderQuotaType.FREE,
      quotaUsed,
      quotaLimit,
      quotaPeriodStart: config.quotaPeriodStart,
      quotaPeriodEnd: config.quotaPeriodEnd,
      percentUsed: Math.round(percentUsed * 100) / 100,
      isExceeded: quotaUsed >= quotaLimit,
    }
  }

  /**
   * Check if the organization has available quota
   * @returns true if quota is available, false if exceeded
   */
  async hasAvailableQuota(): Promise<boolean> {
    if (isSelfHosted()) return true
    const status = await this.getQuotaStatus()
    if (!status) {
      return false
    }
    return !status.isExceeded
  }

  /**
   * Reset quota for the current period
   * Called when a new billing period starts
   */
  async resetQuota(): Promise<void> {
    logger.info('Resetting quota for organization', { organizationId: this.organizationId })

    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    await this.db
      .update(schema.ProviderConfiguration)
      .set({
        quotaUsed: 0,
        quotaPeriodStart: now,
        quotaPeriodEnd: periodEnd,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, this.organizationId),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
        )
      )

    logger.info('Quota reset complete', { organizationId: this.organizationId })
  }
}

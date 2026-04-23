// packages/lib/src/seed/entity-migrations/migrations/010-organization-ai-quota.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { DEFAULT_QUOTA_LIMITS, ProviderQuotaType } from '../../../ai/providers/types'
import { getNumericFeatureLimit } from '../../../permissions/types'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:010')

/**
 * Migration 010: Backfill `OrganizationAiQuota` rows for orgs that existed
 * before Drizzle migration 0126 introduced the table.
 *
 * Resolution priority per org:
 *   1. Active plan's `monthlyAiCredits` feature limit (most accurate).
 *   2. Legacy `ProviderConfiguration.quotaLimit` where `providerType='SYSTEM'`
 *      (carries `quotaUsed` and period so mid-cycle backfills don't hand out
 *      a clean pool).
 *   3. `DEFAULT_QUOTA_LIMITS[FREE]` (50) as the final fallback.
 *
 * Idempotent — early-returns when a row already exists for the org.
 */
export const migration010OrganizationAiQuota: EntityMigration = {
  id: '010-organization-ai-quota',
  description: 'Backfill OrganizationAiQuota rows for pre-0126 organizations',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await db.query.OrganizationAiQuota.findFirst({
      where: eq(schema.OrganizationAiQuota.organizationId, organizationId),
    })
    if (existing) return { ...state, alreadyUpToDate: true }

    const now = new Date()
    const defaultPeriodEnd = new Date(now)
    defaultPeriodEnd.setMonth(defaultPeriodEnd.getMonth() + 1)

    let quotaLimit: number
    let quotaType: ProviderQuotaType
    let quotaUsed = 0
    let periodStart: Date = now
    let periodEnd: Date = defaultPeriodEnd
    let source: 'plan' | 'legacy' | 'default'

    // 1. Prefer the active plan's monthlyAiCredits.
    const subscription = await db.query.PlanSubscription.findFirst({
      where: eq(schema.PlanSubscription.organizationId, organizationId),
    })
    const plan = subscription?.planId
      ? await db.query.Plan.findFirst({ where: eq(schema.Plan.id, subscription.planId) })
      : null
    const planLimit = plan ? getNumericFeatureLimit(plan.featureLimits, 'monthlyAiCredits') : null

    if (planLimit != null) {
      quotaLimit = planLimit
      quotaType = ProviderQuotaType.PAID
      source = 'plan'
    } else {
      // 2. Fall back to the legacy per-provider SYSTEM row.
      const legacy = await db.query.ProviderConfiguration.findFirst({
        where: and(
          eq(schema.ProviderConfiguration.organizationId, organizationId),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM')
        ),
      })
      if (legacy?.quotaLimit != null) {
        quotaLimit = legacy.quotaLimit
        quotaType = (legacy.quotaType as ProviderQuotaType | null) ?? ProviderQuotaType.FREE
        quotaUsed = legacy.quotaUsed ?? 0
        periodStart = legacy.quotaPeriodStart ?? now
        periodEnd = legacy.quotaPeriodEnd ?? defaultPeriodEnd
        source = 'legacy'
      } else {
        // 3. Last-resort default.
        quotaLimit = DEFAULT_QUOTA_LIMITS[ProviderQuotaType.FREE]
        quotaType = ProviderQuotaType.FREE
        source = 'default'
      }
    }

    await db
      .insert(schema.OrganizationAiQuota)
      .values({
        organizationId,
        quotaType,
        quotaLimit,
        quotaUsed,
        quotaPeriodStart: periodStart,
        quotaPeriodEnd: periodEnd,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()

    logger.info('Migration 010 applied', {
      organizationId,
      quotaType,
      quotaLimit,
      quotaUsed,
      source,
    })

    return { ...state, alreadyUpToDate: false }
  },
}

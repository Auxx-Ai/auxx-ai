// packages/database/scripts/backfill-organization-ai-quota.ts
/**
 * One-time backfill: create an `OrganizationAiQuota` row for every org that
 * doesn't have one, lifting `quotaUsed` / `quotaLimit` / `quotaPeriod*` off the
 * legacy per-provider `ProviderConfiguration` columns.
 *
 * Run with:
 *   npx dotenv -- npx tsx packages/database/scripts/backfill-organization-ai-quota.ts
 *   npx dotenv -- npx tsx packages/database/scripts/backfill-organization-ai-quota.ts --dry-run
 *
 * Aggregation rules (per org):
 *   - quotaUsed  = SUM(ProviderConfiguration.quotaUsed) across SYSTEM rows.
 *                  Credits spent on Anthropic AND OpenAI should both count
 *                  against the unified org pool.
 *   - quotaLimit = plan.featureLimits.monthlyAiCredits when a PlanSubscription
 *                  exists; else MAX legacy quotaLimit across SYSTEM rows;
 *                  else DEFAULT_FREE (50).
 *   - quotaType  = preference order paid > trial > free, based on legacy
 *                  values present on the SYSTEM rows.
 *   - period     = earliest legacy quotaPeriodStart and latest quotaPeriodEnd
 *                  so the daily cron flips it cleanly; falls back to
 *                  [now, now + 1 month] when no legacy rows exist.
 *   - quotaUsed is capped at quotaLimit for finite limits (no negative
 *                  remainder) and left untouched when unlimited (-1).
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import { database as db } from '../src'
import { Organization } from '../src/db/schema/organization'
import { OrganizationAiQuota } from '../src/db/schema/organization-ai-quota'
import { Plan } from '../src/db/schema/plan'
import { PlanSubscription } from '../src/db/schema/plan-subscription'
import { ProviderConfiguration } from '../src/db/schema/provider-configuration'

const DEFAULT_FREE_CREDITS = 50
const QUOTA_TYPE_PRIORITY: Record<string, number> = { paid: 3, trial: 2, free: 1 }

const isDryRun = process.argv.includes('--dry-run')

/** Resolve `monthlyAiCredits` out of a Plan.featureLimits JSON blob. */
function readMonthlyAiCreditsFromPlan(limitsJson: unknown): number | null {
  if (!Array.isArray(limitsJson)) return null
  const match = limitsJson.find(
    (entry) =>
      entry && typeof entry === 'object' && (entry as { key?: unknown }).key === 'monthlyAiCredits'
  )
  if (!match) return null
  const limit = (match as { limit?: unknown }).limit
  if (limit === '+') return -1
  if (typeof limit === 'number') return limit
  return null
}

function addOneMonth(from: Date): Date {
  const end = new Date(from)
  end.setMonth(end.getMonth() + 1)
  return end
}

async function backfill() {
  console.log(`[${isDryRun ? 'DRY RUN' : 'LIVE'}] Starting OrganizationAiQuota backfill...`)

  const orgsMissingQuota = await db
    .select({ id: Organization.id })
    .from(Organization)
    .leftJoin(OrganizationAiQuota, eq(OrganizationAiQuota.organizationId, Organization.id))
    .where(isNull(OrganizationAiQuota.organizationId))

  console.log(`Found ${orgsMissingQuota.length} organizations without an OrganizationAiQuota row.`)

  let inserted = 0
  let skipped = 0
  let errors = 0
  const now = new Date()

  for (const { id: organizationId } of orgsMissingQuota) {
    try {
      const legacyRows = await db
        .select({
          quotaType: ProviderConfiguration.quotaType,
          quotaLimit: ProviderConfiguration.quotaLimit,
          quotaUsed: ProviderConfiguration.quotaUsed,
          quotaPeriodStart: ProviderConfiguration.quotaPeriodStart,
          quotaPeriodEnd: ProviderConfiguration.quotaPeriodEnd,
        })
        .from(ProviderConfiguration)
        .where(
          and(
            eq(ProviderConfiguration.organizationId, organizationId),
            eq(ProviderConfiguration.providerType, 'SYSTEM')
          )
        )

      const subscription = await db.query.PlanSubscription.findFirst({
        where: eq(PlanSubscription.organizationId, organizationId),
      })
      const plan = subscription?.planId
        ? await db.query.Plan.findFirst({ where: eq(Plan.id, subscription.planId) })
        : null
      const planLimit = plan ? readMonthlyAiCreditsFromPlan(plan.featureLimits) : null

      const legacyUsedTotal = legacyRows.reduce((sum, r) => sum + (r.quotaUsed ?? 0), 0)
      const legacyMaxLimit = legacyRows.reduce<number | null>((max, r) => {
        if (r.quotaLimit === null || r.quotaLimit === undefined) return max
        if (max === null) return r.quotaLimit
        if (max === -1 || r.quotaLimit === -1) return -1
        return Math.max(max, r.quotaLimit)
      }, null)

      const quotaLimit = planLimit ?? legacyMaxLimit ?? DEFAULT_FREE_CREDITS

      const quotaType =
        legacyRows
          .map((r) => r.quotaType)
          .filter((t): t is string => !!t)
          .reduce((best: string | null, t) => {
            const rank = QUOTA_TYPE_PRIORITY[t] ?? 0
            const bestRank = best ? (QUOTA_TYPE_PRIORITY[best] ?? 0) : -1
            return rank > bestRank ? t : best
          }, null) ?? (planLimit && planLimit > DEFAULT_FREE_CREDITS ? 'paid' : 'free')

      const legacyPeriodStart = legacyRows
        .map((r) => r.quotaPeriodStart)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0]
      const legacyPeriodEnd = legacyRows
        .map((r) => r.quotaPeriodEnd)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0]

      const quotaPeriodStart = legacyPeriodStart ?? now
      const quotaPeriodEnd = legacyPeriodEnd ?? addOneMonth(now)

      const quotaUsed = quotaLimit === -1 ? legacyUsedTotal : Math.min(legacyUsedTotal, quotaLimit)

      if (isDryRun) {
        console.log(
          `  [DRY] ${organizationId} → type=${quotaType} limit=${quotaLimit} used=${quotaUsed} ` +
            `(legacy rows=${legacyRows.length}, legacyUsedTotal=${legacyUsedTotal}, planLimit=${planLimit ?? 'none'})`
        )
        inserted += 1
        continue
      }

      const result = await db
        .insert(OrganizationAiQuota)
        .values({
          organizationId,
          quotaType,
          quotaLimit,
          quotaUsed,
          quotaPeriodStart,
          quotaPeriodEnd,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ organizationId: OrganizationAiQuota.organizationId })

      if (result.length > 0) {
        inserted += 1
      } else {
        skipped += 1
      }
    } catch (err) {
      errors += 1
      console.error(`  ERROR org=${organizationId}:`, err instanceof Error ? err.message : err)
    }
  }

  const totalRows = await db.select({ n: sql<number>`count(*)` }).from(OrganizationAiQuota)
  console.log('Backfill completed.')
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Skipped (race/conflict): ${skipped}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  OrganizationAiQuota row count now: ${totalRows[0]?.n ?? 'unknown'}`)

  process.exit(errors > 0 ? 1 : 0)
}

backfill().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})

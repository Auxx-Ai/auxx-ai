// packages/lib/src/data-migrations/migrations/066-demo-monthly-ai-credits.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { invalidatePlans, onCacheEvent } from '../../cache/invalidate'
import type { FeatureDefinition } from '../../permissions/types'
import { parseFeatureLimits } from '../../permissions/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-066')

/** Usage-limit key this migration retunes. */
const LIMIT_KEY = 'monthlyAiCredits'

/** Target allowance for the Demo plan, matching `USAGE_LIMITS.demo` in the seeder. */
const DEMO_MONTHLY_AI_CREDITS = 5_000

/** The only plan this migration touches — every other tier keeps its current value. */
const TARGET_PLAN_NAME = 'Demo'

/**
 * Set `monthlyAiCredits` on one plan's stored feature array. Returns the array unchanged
 * with `changed: false` when it already matches, so a second pass rewrites nothing.
 *
 * Exported so a test checks the merge rule rather than the JSONB plumbing.
 */
export function applyDemoCreditLimit(
  limitsJson: unknown,
  limit: number
): { limits: FeatureDefinition[]; changed: boolean } {
  const defs = parseFeatureLimits(limitsJson)

  let changed = false
  let sawLimit = false
  const limits: FeatureDefinition[] = []

  for (const def of defs) {
    if (def.key === LIMIT_KEY) {
      sawLimit = true
      if (def.limit !== limit) changed = true
      limits.push({ key: LIMIT_KEY, limit })
      continue
    }
    limits.push(def)
  }

  // Append rather than assume a slot: a plan edited in the admin panel may be missing
  // keys entirely (same reasoning as migrations 063/064).
  if (!sawLimit) {
    limits.push({ key: LIMIT_KEY, limit })
    changed = true
  }

  return { limits, changed }
}

/**
 * Retune the Demo plan's `monthlyAiCredits` from 2,000 to 5,000.
 *
 * **Why a migration at all.** `Plan.featureLimits` is stored JSONB and the seeder only
 * rewrites a plan it is re-seeding, so editing `billing.domain.ts` alone leaves every
 * existing environment on the old number.
 *
 * **Why this matters more than the catalog.** Until now the Demo plan's declared
 * allowance was inert: `OrganizationSeeder.seedAiProviderQuotas` writes
 * `DEFAULT_QUOTA_LIMITS[TRIAL]` (20,000) into `OrganizationAiQuota` for every new org,
 * and the only code that reconciles that row against the plan is the Stripe
 * `subscription.updated` webhook — which a demo org, having no Stripe subscription,
 * never receives. Demo sessions therefore ran on 20,000 credits (≈ $2 of AI COGS)
 * while the plan said 2,000. The companion fix in `/api/demo/create-session` now reads
 * this key when it swaps the trial subscription for the Demo one, which is what makes
 * the value below actually reach a demo org.
 *
 * Raw Drizzle on purpose (project convention): the plan/feature service paths fire
 * subscription and overage side effects that a catalog fixup has no business entering.
 * The cache busting those paths would have done is performed explicitly below —
 * `features` is a PER-ORG key derived from the plan, so `invalidatePlans()` alone would
 * leave every org serving a stale feature map until its TTL.
 *
 * No backfill of live demo orgs: demo sessions last one hour and `demoCleanupJob`
 * deletes them on expiry, so the population self-drains well inside a deploy cycle.
 */
export const migration066DemoMonthlyAiCredits: DataMigrationDef = {
  id: '066-demo-monthly-ai-credits',
  description: 'Raise the Demo plan monthlyAiCredits limit to 5,000',
  async run(db: Database): Promise<void> {
    const plans = await db
      .select({
        id: schema.Plan.id,
        name: schema.Plan.name,
        featureLimits: schema.Plan.featureLimits,
        trialFeatureLimits: schema.Plan.trialFeatureLimits,
      })
      .from(schema.Plan)
      .where(eq(schema.Plan.name, TARGET_PLAN_NAME))

    const plan = plans[0]
    if (!plan) {
      logger.info('No Demo plan in this environment — nothing to do')
      return
    }

    const features = applyDemoCreditLimit(plan.featureLimits, DEMO_MONTHLY_AI_CREDITS)
    // `trialFeatureLimits` is nullable and, when present, is a FULL replacement array
    // read instead of `featureLimits`, so it needs the same treatment.
    const trial =
      plan.trialFeatureLimits == null
        ? { limits: [], changed: false }
        : applyDemoCreditLimit(plan.trialFeatureLimits, DEMO_MONTHLY_AI_CREDITS)

    if (!features.changed && !trial.changed) {
      logger.info('Demo plan already carried the target credit limit — nothing to do')
      return
    }

    await db
      .update(schema.Plan)
      .set({
        ...(features.changed ? { featureLimits: features.limits } : {}),
        ...(trial.changed ? { trialFeatureLimits: trial.limits } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.Plan.id, plan.id))

    // The global plan catalog first, then the per-org `features` map derived from it.
    // `plan.changed` fans out to `features` + `subscription` + `overages`.
    await invalidatePlans()
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    for (const org of orgs) {
      await onCacheEvent('plan.changed', { orgId: org.id })
    }

    logger.info('Retuned the Demo plan credit allowance', {
      limit: DEMO_MONTHLY_AI_CREDITS,
      orgs: orgs.length,
    })
  },
}

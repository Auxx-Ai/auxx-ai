// packages/lib/src/data-migrations/migrations/064-sequences-limit.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { invalidatePlans, onCacheEvent } from '../../cache/invalidate'
import type { FeatureDefinition } from '../../permissions/types'
import { parseFeatureLimits } from '../../permissions/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-064')

/** Static-limit key this migration introduces. */
const LIMIT_KEY = 'sequencesLimit'
/** Boolean gate it pairs with (already present on every plan). */
const GATE_KEY = 'sequences'

/**
 * Target state per plan, keyed by `Plan.name` — the same matrix the seeder now
 * carries in `STATIC_LIMITS`/`BOOLEAN_GATES` (packages/seed/src/domains/billing.domain.ts).
 *
 * Unlike migration 063's fold, this one CANNOT be derived from the existing data:
 * `sequencesLimit` did not exist before, so there is nothing to compute it from, and
 * the Demo/Starter gate flip is a pricing decision rather than arithmetic. Hard-coding
 * by plan name is therefore the honest form. A plan whose name is not in this map (a
 * hand-created custom plan) is deliberately left ALONE — it keeps whatever `sequences`
 * gate it has and simply gains no limit key, which reads as unlimited via `getLimit`.
 */
const TARGET: Record<string, { gate: boolean; limit: number }> = {
  Demo: { gate: true, limit: 3 },
  Free: { gate: false, limit: 0 },
  Starter: { gate: true, limit: 3 },
  Growth: { gate: true, limit: 25 },
  Enterprise: { gate: true, limit: -1 },
}

/**
 * Apply the target `sequences` gate + `sequencesLimit` to one plan's stored feature
 * array. Returns the array unchanged with `changed: false` when it already matches, so
 * a second pass rewrites nothing.
 *
 * Exported so a test checks the merge rule rather than the JSONB plumbing.
 */
export function applySequencesLimit(
  limitsJson: unknown,
  target: { gate: boolean; limit: number }
): { limits: FeatureDefinition[]; changed: boolean } {
  const defs = parseFeatureLimits(limitsJson)

  let changed = false
  let sawLimit = false
  const limits: FeatureDefinition[] = []

  for (const def of defs) {
    if (def.key === LIMIT_KEY) {
      sawLimit = true
      if (def.limit !== target.limit) changed = true
      limits.push({ key: LIMIT_KEY, limit: target.limit })
      continue
    }
    if (def.key === GATE_KEY) {
      if (def.limit !== target.gate) changed = true
      limits.push({ key: GATE_KEY, limit: target.gate })
      continue
    }
    limits.push(def)
  }

  // Append rather than assume a slot: `composeFeatureLimits` guarantees key order
  // only for freshly seeded plans, and a plan edited in the admin panel may be
  // missing keys entirely (same reasoning as migration 063).
  if (!sawLimit) {
    limits.push({ key: LIMIT_KEY, limit: target.limit })
    changed = true
  }

  return { limits, changed }
}

/**
 * Add the `sequencesLimit` static limit to every seeded `Plan`, and open the
 * `sequences` boolean gate on Demo and Starter.
 *
 * **Why a migration at all.** `Plan.featureLimits` is stored JSONB and the seeder only
 * rewrites a plan it is re-seeding, so editing `billing.domain.ts` alone leaves every
 * existing environment with no `sequencesLimit` key. Absent, `getLimit` returns `null`
 * and `requireLimit` returns early — i.e. sequences would stay silently UNCAPPED on
 * Growth, which is the tier the cap is for.
 *
 * The counting side is `countSequencesUsed`, which excludes the five seeded
 * client-notification templates; they are undeletable, so counting them would strand
 * an org over its cap with no way back under. No backfill of org data is needed here —
 * only the plan catalog changes.
 *
 * Raw Drizzle on purpose (project convention): the plan/feature service paths fire
 * subscription and overage side effects that a catalog fixup has no business entering.
 * The cache busting those paths would have done is performed explicitly below —
 * `features` is a PER-ORG key derived from the plan, so `invalidatePlans()` alone would
 * leave every org serving a stale feature map until its TTL.
 */
export const migration064SequencesLimit: DataMigrationDef = {
  id: '064-sequences-limit',
  description:
    'Add the sequencesLimit static limit to every plan and open sequences on Demo/Starter',
  async run(db: Database): Promise<void> {
    const plans = await db
      .select({
        id: schema.Plan.id,
        name: schema.Plan.name,
        featureLimits: schema.Plan.featureLimits,
        trialFeatureLimits: schema.Plan.trialFeatureLimits,
      })
      .from(schema.Plan)

    let updated = 0
    for (const plan of plans) {
      const target = TARGET[plan.name]
      if (!target) {
        logger.info('Plan not in the target matrix — left untouched', { plan: plan.name })
        continue
      }

      const features = applySequencesLimit(plan.featureLimits, target)
      // `trialFeatureLimits` is nullable and, when present, is a FULL replacement array
      // read instead of `featureLimits`, so it needs the same treatment.
      const trial =
        plan.trialFeatureLimits == null
          ? { limits: [], changed: false }
          : applySequencesLimit(plan.trialFeatureLimits, target)
      if (!features.changed && !trial.changed) continue

      await db
        .update(schema.Plan)
        .set({
          ...(features.changed ? { featureLimits: features.limits } : {}),
          ...(trial.changed ? { trialFeatureLimits: trial.limits } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.Plan.id, plan.id))
      updated += 1
      logger.info('Applied sequences limit', { plan: plan.name, ...target })
    }

    if (updated === 0) {
      logger.info('Every plan already carried the target sequences limit — nothing to do')
      return
    }

    // The global plan catalog first, then the per-org `features` map derived from it.
    // `plan.changed` fans out to `features` + `subscription` + `overages`.
    await invalidatePlans()
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    for (const org of orgs) {
      await onCacheEvent('plan.changed', { orgId: org.id })
    }

    logger.info('Seeded the sequencesLimit feature key', { plans: updated, orgs: orgs.length })
  },
}

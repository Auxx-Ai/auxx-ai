// packages/lib/src/data-migrations/migrations/072-mail-filters-limit.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { invalidatePlans, onCacheEvent } from '../../cache/invalidate'
import type { FeatureDefinition } from '../../permissions/types'
import { parseFeatureLimits } from '../../permissions/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-072')

/** Static-limit key this migration introduces. */
const LIMIT_KEY = 'mailFiltersLimit'

/**
 * Target limit per plan, keyed by `Plan.name` — the same matrix the seeder now carries
 * in `STATIC_LIMITS` (packages/seed/src/domains/billing.domain.ts).
 *
 * There is nothing in the stored data to derive this from: `mailFiltersLimit` did not
 * exist before, and the per-tier numbers are a pricing decision rather than arithmetic.
 * Hard-coding by plan name is therefore the honest form. A plan whose name is not in
 * this map (a hand-created custom plan) is deliberately left ALONE — it simply gains no
 * limit key, which reads as unlimited via `getLimit`.
 *
 * Free is deliberately NOT 0: `0` reads as *feature off* in this schema, and filters
 * carry no marginal cost (unlike `sequencesLimit`/`datasetsLimit`/`agentsLimit`, which
 * are 0 on Free).
 */
const TARGET: Record<string, number> = {
  Demo: 10,
  Free: 5,
  Starter: 25,
  Growth: -1,
  Enterprise: -1,
}

/**
 * Apply the target `mailFiltersLimit` to one plan's stored feature array. Returns the
 * array unchanged with `changed: false` when it already matches, so a second pass
 * rewrites nothing.
 *
 * Exported so a test checks the merge rule rather than the JSONB plumbing.
 */
export function applyMailFiltersLimit(
  limitsJson: unknown,
  target: number
): { limits: FeatureDefinition[]; changed: boolean } {
  const defs = parseFeatureLimits(limitsJson)

  let changed = false
  let sawLimit = false
  const limits: FeatureDefinition[] = []

  for (const def of defs) {
    if (def.key === LIMIT_KEY) {
      sawLimit = true
      if (def.limit !== target) changed = true
      limits.push({ key: LIMIT_KEY, limit: target })
      continue
    }
    limits.push(def)
  }

  // Append rather than assume a slot: `composeFeatureLimits` guarantees key order only
  // for freshly seeded plans, and a plan edited in the admin panel may be missing keys
  // entirely (same reasoning as migrations 063/064).
  if (!sawLimit) {
    limits.push({ key: LIMIT_KEY, limit: target })
    changed = true
  }

  return { limits, changed }
}

/**
 * Add the `mailFiltersLimit` static limit to every seeded `Plan`.
 *
 * **Why a migration at all.** `Plan.featureLimits` is stored JSONB and the seeder only
 * rewrites a plan it is re-seeding, so editing `billing.domain.ts` alone leaves every
 * existing environment with no `mailFiltersLimit` key. Absent, `FeaturePermissionService.getLimit`
 * returns `null` and `requireLimit` returns early — i.e. filters would stay silently
 * UNCAPPED everywhere, and the create gate would be decorative. The seeder change and
 * this migration ship together (plan §5.2, invariant 14).
 *
 * **There is no paired boolean gate for this key** — unlike migration 064's
 * `sequences` gate, filters are core mail UX and are always on; the only lever is the
 * count. Nothing here turns the feature off.
 *
 * The counting side is `countBillableMailFilters`, which excludes seeded (`templateKey`)
 * starter filters — we provision those, so charging a customer's allowance for them
 * would strand orgs over their cap with no way back under — and counts shared-inbox
 * filters only; personal-inbox filters carry a flat per-user ceiling instead. No backfill
 * of org data is needed here — only the plan catalog changes.
 *
 * Raw Drizzle on purpose (project convention): the plan/feature service paths fire
 * subscription and overage side effects that a catalog fixup has no business entering.
 * The cache busting those paths would have done is performed explicitly below —
 * `features` is a PER-ORG key derived from the plan, so `invalidatePlans()` alone would
 * leave every org serving a stale feature map until its TTL.
 */
export const migration072MailFiltersLimit: DataMigrationDef = {
  id: '072-mail-filters-limit',
  description: 'Add the mailFiltersLimit static limit to every plan',
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
      if (target === undefined) {
        logger.info('Plan not in the target matrix — left untouched', { plan: plan.name })
        continue
      }

      const features = applyMailFiltersLimit(plan.featureLimits, target)
      // `trialFeatureLimits` is nullable and, when present, is a FULL replacement array
      // read instead of `featureLimits`, so it needs the same treatment.
      const trial =
        plan.trialFeatureLimits == null
          ? { limits: [], changed: false }
          : applyMailFiltersLimit(plan.trialFeatureLimits, target)
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
      logger.info('Applied mail filters limit', { plan: plan.name, limit: target })
    }

    if (updated === 0) {
      logger.info('Every plan already carried the target mail filters limit — nothing to do')
      return
    }

    // The global plan catalog first, then the per-org `features` map derived from it.
    // `plan.changed` fans out to `features` + `subscription` + `overages`.
    await invalidatePlans()
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    for (const org of orgs) {
      await onCacheEvent('plan.changed', { orgId: org.id })
    }

    logger.info('Seeded the mailFiltersLimit feature key', { plans: updated, orgs: orgs.length })
  },
}

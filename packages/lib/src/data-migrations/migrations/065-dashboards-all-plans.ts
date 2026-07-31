// packages/lib/src/data-migrations/migrations/065-dashboards-all-plans.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { invalidatePlans, onCacheEvent } from '../../cache/invalidate'
import type { FeatureDefinition } from '../../permissions/types'
import { parseFeatureLimits } from '../../permissions/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-065')

/** The boolean gate this migration opens. */
const GATE_KEY = 'dashboards'

/**
 * Force the `dashboards` boolean gate open in one plan's stored feature array,
 * appending the key when a hand-edited plan lacks it entirely.
 *
 * Unlike migration 064 there is no per-plan target matrix: dashboards is now on
 * for EVERY tier, so the target is the same constant everywhere and custom
 * plans get it too. Returns `changed: false` when the array already says `true`,
 * so a second pass rewrites nothing.
 *
 * Exported so a test checks the merge rule rather than the JSONB plumbing.
 */
export function openDashboardsGate(limitsJson: unknown): {
  limits: FeatureDefinition[]
  changed: boolean
} {
  const defs = parseFeatureLimits(limitsJson)

  let changed = false
  let sawGate = false
  const limits: FeatureDefinition[] = []

  for (const def of defs) {
    if (def.key === GATE_KEY) {
      sawGate = true
      if (def.limit !== true) changed = true
      limits.push({ key: GATE_KEY, limit: true })
      continue
    }
    limits.push(def)
  }

  // Append rather than assume a slot: `composeFeatureLimits` guarantees key order
  // only for freshly seeded plans, and a plan edited in the admin panel may be
  // missing keys entirely (same reasoning as migrations 063/064).
  if (!sawGate) {
    limits.push({ key: GATE_KEY, limit: true })
    changed = true
  }

  return { limits, changed }
}

/**
 * Open the `dashboards` boolean gate on every `Plan` — dashboards ships on all
 * tiers, not just Growth and Enterprise.
 *
 * **Why a migration at all.** `Plan.featureLimits` is stored JSONB and the seeder
 * only rewrites a plan it is re-seeding, so flipping `BOOLEAN_GATES` in
 * `packages/seed/src/domains/billing.domain.ts` alone leaves every existing
 * environment with Demo/Free/Starter still reading `dashboards: false`. Booleans
 * fail CLOSED in `FeaturePermissionService.hasAccess` (`false` and `undefined`
 * both deny), so the stale rows would keep the locked upgrade state on the
 * dashboards surfaces indefinitely.
 *
 * Applied unconditionally to every plan row, including hand-created custom ones:
 * "available on all plans" has no exceptions to carve out, which is why this one
 * needs no name-keyed target matrix.
 *
 * Raw Drizzle on purpose (project convention): the plan/feature service paths fire
 * subscription and overage side effects that a catalog fixup has no business entering.
 * The cache busting those paths would have done is performed explicitly below —
 * `features` is a PER-ORG key derived from the plan, so `invalidatePlans()` alone would
 * leave every org serving a stale feature map until its TTL.
 */
export const migration065DashboardsAllPlans: DataMigrationDef = {
  id: '065-dashboards-all-plans',
  description: 'Open the dashboards boolean gate on every plan',
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
      const features = openDashboardsGate(plan.featureLimits)
      // `trialFeatureLimits` is nullable and, when present, is a FULL replacement array
      // read instead of `featureLimits`, so it needs the same treatment.
      const trial =
        plan.trialFeatureLimits == null
          ? { limits: [], changed: false }
          : openDashboardsGate(plan.trialFeatureLimits)
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
      logger.info('Opened the dashboards gate', { plan: plan.name })
    }

    if (updated === 0) {
      logger.info('Every plan already had dashboards open — nothing to do')
      return
    }

    // The global plan catalog first, then the per-org `features` map derived from it.
    // `plan.changed` fans out to `features` + `subscription` + `overages`.
    await invalidatePlans()
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    for (const org of orgs) {
      await onCacheEvent('plan.changed', { orgId: org.id })
    }

    logger.info('Dashboards is now available on every plan', {
      plans: updated,
      orgs: orgs.length,
    })
  },
}

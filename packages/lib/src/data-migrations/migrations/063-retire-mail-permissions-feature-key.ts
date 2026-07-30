// packages/lib/src/data-migrations/migrations/063-retire-mail-permissions-feature-key.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { invalidatePlans, onCacheEvent } from '../../cache/invalidate'
import type { FeatureDefinition, FeatureLimit } from '../../permissions/types'
import { parseFeatureLimits } from '../../permissions/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-063')

/** The key this migration deletes. Deliberately a literal — the enum member is gone. */
const RETIRED_KEY = 'mailPermissions'
/** The key it folds onto. */
const SURVIVING_KEY = 'granularPermissions'

/**
 * Fold `mailPermissions` into `granularPermissions` inside ONE plan's feature
 * array (plan v3/03 §7.6 / D9).
 *
 * The rule is `granularPermissions ||= mailPermissions`, and it is the whole
 * migration: nothing that could share mail before may lose it, and the target
 * matrix falls out of the arithmetic rather than being hard-coded per plan name.
 * On the shipped seed that yields exactly Demo + Growth + Enterprise (Demo was
 * mail-only and gains the key; Growth was granular-only and gains mail sharing;
 * Enterprise held both; Free/Starter held neither).
 *
 * Exported so the merge rule — not the JSONB plumbing around it — is what a test
 * checks.
 *
 * Idempotent by construction: a second pass finds no `mailPermissions` entry,
 * `changed` stays `false`, and the row is not rewritten. Order is preserved and a
 * missing `granularPermissions` entry is APPENDED rather than assumed, because
 * `composeFeatureLimits` guarantees key order only for freshly seeded plans and a
 * plan edited by hand in the admin panel may be missing keys entirely.
 */
export function foldMailPermissions(limitsJson: unknown): {
  limits: FeatureDefinition[]
  changed: boolean
} {
  const defs = parseFeatureLimits(limitsJson)
  const retired = defs.find((d) => d.key === RETIRED_KEY)
  if (!retired) return { limits: defs, changed: false }

  const survives = truthyLimit(retired.limit)
  const limits: FeatureDefinition[] = []
  let sawSurviving = false
  for (const def of defs) {
    if (def.key === RETIRED_KEY) continue
    if (def.key === SURVIVING_KEY) {
      sawSurviving = true
      limits.push({ key: SURVIVING_KEY, limit: truthyLimit(def.limit) || survives })
      continue
    }
    limits.push(def)
  }
  if (!sawSurviving) limits.push({ key: SURVIVING_KEY, limit: survives })
  return { limits, changed: true }
}

/**
 * Whether a stored {@link FeatureLimit} means "on", using the SAME reading
 * `FeaturePermissionService.hasAccess` applies (`undefined` / `false` / `0` are
 * off, everything else — including `'+'` and any positive number — is on). A bare
 * `Boolean(limit)` would read the numeric `0` a hand-edited plan can carry as
 * `false` correctly but `'+'`-as-string is the case that matters: it must be on.
 */
function truthyLimit(limit: FeatureLimit | undefined): boolean {
  return !(limit === undefined || limit === false || limit === 0)
}

/**
 * Remove the retired `mailPermissions` feature key from every already-seeded
 * `Plan` row, folding its value into `granularPermissions` (plan v3/03 §7.6).
 *
 * **Why a migration at all.** `Plan.featureLimits` is a stored JSONB array, and
 * the seeder only rewrites a plan it is re-seeding — so without this pass every
 * existing environment keeps serving a `mailPermissions` entry that no code reads
 * any more (dead but harmless) AND, worse, a Demo org keeps
 * `granularPermissions: false` while every mail-sharing gate has just moved onto
 * that key. That is a silent capability LOSS on the demo plan, which is why the
 * fold runs rather than a plain delete.
 *
 * Raw Drizzle on purpose (project convention): the plan/feature service paths
 * fire subscription and overage side effects that a schema-shape fixup has no
 * business entering. The cache busting the service would have done is performed
 * explicitly below — `features` is a PER-ORG key derived from the plan, so
 * `invalidatePlans()` alone would leave every org serving a stale feature map
 * until its TTL.
 *
 * Self-sufficient and idempotent: it reads the current JSON, decides from the
 * data, and writes only rows that actually change.
 */
export const migration063RetireMailPermissionsFeatureKey: DataMigrationDef = {
  id: '063-retire-mail-permissions-feature-key',
  description:
    'Fold the retired mailPermissions feature key into granularPermissions on every plan',
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
      const features = foldMailPermissions(plan.featureLimits)
      // `trialFeatureLimits` is nullable and, when present, is a FULL replacement
      // array read instead of `featureLimits` — so it carries its own copy of the
      // retired key and needs the same fold.
      const trial =
        plan.trialFeatureLimits == null
          ? { limits: [], changed: false }
          : foldMailPermissions(plan.trialFeatureLimits)
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
      logger.info('Folded mailPermissions into granularPermissions', { plan: plan.name })
    }

    if (updated === 0) {
      logger.info('No plan carried the retired mailPermissions key — nothing to do')
      return
    }

    // The global plan catalog first, then the per-org `features` map derived from
    // it. `plan.changed` fans out to `features` + `subscription` + `overages`.
    await invalidatePlans()
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    for (const org of orgs) {
      await onCacheEvent('plan.changed', { orgId: org.id })
    }

    logger.info('Retired the mailPermissions feature key', { plans: updated, orgs: orgs.length })
  },
}

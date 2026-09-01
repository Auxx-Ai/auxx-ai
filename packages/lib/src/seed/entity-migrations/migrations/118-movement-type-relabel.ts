// packages/lib/src/seed/entity-migrations/migrations/118-movement-type-relabel.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:118')

/**
 * The two `stock_movement_type` options a build writes, relabelled
 * (plans/money/tasks/23-build-from-the-part.md §6).
 *
 * `Build (produce)` / `Build (consume)` name the mechanism; `Produced` /
 * `Consumed` name what happened to the stock, which is what the other options
 * beside them do (`Receive`, `Adjust`, `Sale`).
 *
 * 🛑 Both, or neither. `Produced` next to `Build (consume)` is a worse pairing
 * than either original, so the two move in ONE spec array rather than in two
 * migrations.
 */
export const MOVEMENT_TYPE_RELABELS = [
  { value: 'build_consume', old: 'Build (consume)', next: 'Consumed' },
  { value: 'build_produce', old: 'Build (produce)', next: 'Produced' },
] as const

/** The one field whose stored `options` JSONB carries them. */
const MOVEMENT_TYPE_ATTRIBUTE = 'stock_movement_type'

/**
 * Decide what to do with one seeded option label.
 *
 * Verbatim from `106-supplier-pricing-relabel.ts`, deliberately — same problem,
 * same rule, and divergence between the two would be a trap.
 *
 * `skip` when the stored label is NEITHER the old nor the new value, because an
 * org that renamed the option themselves owns that string. This migration only
 * replaces what the seeder wrote.
 */
export function resolveLabel(
  current: string,
  spec: { old: string; next: string }
): 'update' | 'up-to-date' | 'skip' {
  if (current === spec.next) return 'up-to-date'
  if (current === spec.old) return 'update'
  return 'skip'
}

/** One stored option, as `CustomField.options.options[]` holds it. */
interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/**
 * Apply the spec array to a stored options list, returning the new list or
 * `null` when nothing changed.
 *
 * 🛑 **`value` and every sibling key are preserved, and so is order.**
 * `FieldValue.optionId` stores the `value` key, so rewriting one here would
 * orphan every stored movement type in the org — 88 rows across the database
 * as measured, all of them on `updatable: false` fields that nothing can
 * restate. Only `label` is touched, and only on the two options named.
 *
 * Pure, so the rule is testable without a database.
 */
export function relabelOptions(
  options: readonly StoredOption[],
  specs: readonly { value: string; old: string; next: string }[]
): StoredOption[] | null {
  let changed = false
  const next = options.map((option) => {
    const spec = specs.find((candidate) => candidate.value === option.value)
    if (!spec) return option
    const action = resolveLabel(option.label, spec)
    if (action !== 'update') return option
    changed = true
    return { ...option, label: spec.next }
  })
  return changed ? next : null
}

/**
 * Migration 118: `Build (produce)` -> `Produced`, `Build (consume)` ->
 * `Consumed`, in every org's stored `stock_movement_type` options.
 *
 * ## 🛑 Why the enum edit alone is not enough
 *
 * `stock-movement-fields.ts` declares `options: { options: StockMovementType.values }`,
 * and those options are **materialized into `CustomField.options` JSONB at seed
 * time**. `mergeSystemAndCustomFields` reads labels from the DB row, never from
 * the registry — `106-supplier-pricing-relabel.ts` states this exactly, and it
 * is the whole reason that migration exists.
 *
 * So after the registry edit and before this migration, ONE value has TWO labels
 * depending on which surface you are looking at:
 *
 * | Surface | Label source | Shows |
 * | --- | --- | --- |
 * | Inventory card badge, build ledger card | `TYPE_LABEL_MAP` off the registry | `Produced` |
 * | Records view column, filter dropdown, Details panel | DB `CustomField.options` | `Build (produce)` |
 *
 * ## 🛑 `refreshSelectOptions` will not do it
 *
 * `108-purchasing.ts` has a helper that looks like the right tool and is not.
 * Its own doc says so: it compares `value` keys in order and returns `false`
 * when they match, so *"a relabel or recolour alone does not trigger a
 * rewrite."* Passing it this change is a silent no-op.
 *
 * Idempotent — a re-run finds the new labels and reports `alreadyUpToDate`.
 */
export const migration118MovementTypeRelabel: EntityMigration = {
  id: '118-movement-type-relabel',
  description: 'Relabel the two build stock-movement types to Produced and Consumed',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const field = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.modelType, 'stock_movement'),
        eq(schema.CustomField.systemAttribute, MOVEMENT_TYPE_ATTRIBUTE)
      ),
      columns: { id: true, options: true },
    })
    // An org that never got the def (seeded before it existed, or a fleet where
    // parts are off) is not a failure — there is nothing to relabel.
    if (!field) return { ...state, alreadyUpToDate: true }

    const stored = (field.options as { options?: StoredOption[] } | null)?.options
    if (!Array.isArray(stored)) return { ...state, alreadyUpToDate: true }

    const next = relabelOptions(stored, MOVEMENT_TYPE_RELABELS)
    if (!next) {
      // Either already relabelled, or the org renamed these themselves. Both are
      // `alreadyUpToDate`; only the second is worth a line in the log.
      const customized = stored.filter((option) => {
        const spec = MOVEMENT_TYPE_RELABELS.find((s) => s.value === option.value)
        return spec ? resolveLabel(option.label, spec) === 'skip' : false
      })
      if (customized.length > 0) {
        logger.warn('Migration 118 skipped customized movement type labels', {
          organizationId,
          labels: customized.map((option) => option.label),
        })
      }
      return { ...state, alreadyUpToDate: true }
    }

    await db
      .update(schema.CustomField)
      .set({
        options: { ...(field.options as Record<string, unknown>), options: next },
        updatedAt: new Date(),
      })
      .where(eq(schema.CustomField.id, field.id))

    logger.info('Migration 118 applied', { organizationId, optionsRelabelled: next.length })

    return { ...state, alreadyUpToDate: false }
  },
}

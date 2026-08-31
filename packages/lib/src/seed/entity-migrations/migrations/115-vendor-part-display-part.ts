// packages/lib/src/seed/entity-migrations/migrations/115-vendor-part-display-part.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import { notifyEntityDefChanged } from '../../../entity-definitions/notify'
import { DisplayFieldService } from '../../../field-values/display-field-service'
import { fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:115')

/** The join def whose display pointers move. */
export const VENDOR_PART_ENTITY_TYPE = 'vendor_part'

/** The two legs involved, by systemAttribute. */
export const VENDOR_PART_PART_ATTRIBUTE = 'vendor_part_part'
export const VENDOR_PART_SKU_ATTRIBUTE = 'vendor_part_vendor_sku'

/** What the def row currently points at. */
export interface DisplayPointers {
  primaryDisplayFieldId: string | null
  secondaryDisplayFieldId: string | null
}

/** The field ids this migration wants those pointers to hold. */
export interface DisplayTargets {
  partFieldId: string
  skuFieldId: string
}

/**
 * Decide what to do with one org's `vendor_part` display pointers.
 *
 * - `update`     — primary is still the seeded `vendorSku`. This is the case
 *   the migration exists for.
 * - `up-to-date` — primary is already `part`. A re-run, or a fresh org seeded
 *   after the `DISPLAY_FIELD_CONFIG` edit that ships alongside this file. The
 *   nameless-record problem is gone either way, so a secondary the org has
 *   since changed is left alone.
 * - `skip`       — primary points somewhere else entirely. Display fields ARE
 *   user-editable (`EntityDefinitionService.update` writes them, which is the
 *   difference from migration 110's `isVisible`), so a third value is a
 *   deliberate choice and this migration does not overrule it.
 */
export function resolveDisplayRelink(
  current: DisplayPointers,
  targets: DisplayTargets
): 'update' | 'up-to-date' | 'skip' {
  if (current.primaryDisplayFieldId === targets.partFieldId) return 'up-to-date'
  if (current.primaryDisplayFieldId === targets.skuFieldId) return 'update'
  return 'skip'
}

/**
 * Repoint the def and rebuild every instance's denormalized display columns.
 *
 * 🛑 The cache bust between the two is LOAD-BEARING and is not the redundant
 * call it looks like. `DisplayFieldService.recalculateDisplayField` resolves the
 * field through `getCachedResource` → `getOrgCache().get(orgId, 'resources')`,
 * and that snapshot carries `primaryDisplayFieldId` as it was when it was built.
 * The `resources` key has a **ONE_DAY** Redis TTL, so without an explicit
 * invalidation the recalc reads the OLD pointer, recomputes every `displayName`
 * from `vendorSku` to the value it already had, and reports success having
 * changed nothing — a silent no-op the ledger then marks applied.
 *
 * The runner's own post-loop flush (`runEntityMigrationsForOrg`) does not cover
 * this: it fires after every migration has run, and the recalc below needs the
 * new pointer *now*. This is the documented exception to migration 114's
 * "cache invalidation is the runner's job".
 *
 * Safe to invalidate here because `up()` is NOT wrapped in a transaction — the
 * runner calls `migration.up(db, organizationId)` with the raw handle, so the
 * write above has committed and the recompute reads committed state.
 */
async function relinkAndBackfill(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  targets: DisplayTargets,
  repoint: boolean
): Promise<void> {
  if (repoint) {
    await db
      .update(schema.EntityDefinition)
      .set({
        primaryDisplayFieldId: targets.partFieldId,
        secondaryDisplayFieldId: targets.skuFieldId,
        updatedAt: new Date(),
      })
      .where(eq(schema.EntityDefinition.id, entityDefinitionId))
  }

  // Deletes local + Redis and eagerly recomputes from the provider, so the next
  // read is guaranteed fresh. Also publishes `resourceDefChanged`, which is why
  // this is preferred over calling `invalidateAndRecompute` directly.
  await notifyEntityDefChanged(organizationId, entityDefinitionId, 'updated')

  await new DisplayFieldService(organizationId, db).recalculateDisplayFields(entityDefinitionId, [
    'primary',
    'secondary',
  ])
}

/**
 * Count vendor parts left without a display name.
 *
 * Once primary is the `part` leg — `required: true`, `nullable: false` — this
 * is necessarily zero. A non-zero count on the `up-to-date` arm therefore means
 * an earlier run repointed the def and then died before finishing the backfill,
 * and this is what makes the migration self-healing rather than permanently
 * skipping the repair on every subsequent run.
 */
async function countNamelessInstances(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        isNull(schema.EntityInstance.displayName)
      )
    )

  return row?.value ?? 0
}

/**
 * Migration 115: make a `vendor_part`'s display name come from its PART rather
 * than from the supplier's own SKU.
 *
 * ## Why
 *
 * `vendor_part_vendor_sku` is optional — under the `(part, supplier)` natural
 * key the supplier's part number is metadata, not identity, and real price lists
 * routinely omit the column (migration 104 made every org's CustomField row
 * agree). But `vendor_part` still declared that same optional field as its
 * PRIMARY DISPLAY FIELD, and `DisplayFieldService.computeDisplayValue` opens
 * with `if (!typedValue) return null` and has no fallback of any kind. So a
 * supplier price with no SKU got `displayName: null` and rendered nameless
 * anywhere a relation chip resolves it (`purchase_order_line_vendor_part`,
 * `stock_movement.vendorPart`).
 *
 * This was not hypothetical — it was observed on a live row whose part and
 * supplier were both perfectly healthy.
 *
 * `vendor_part_part` is `required: true` / `nullable: false` and is leg 1 of the
 * natural key, so it is the only field guaranteed to be present. `vendorSku`
 * moves to secondary, where its absence costs nothing.
 *
 * ## Why it is a migration and not one constant
 *
 * `linkDisplayFields` runs from `DISPLAY_FIELD_CONFIG` at SEED time only. Editing
 * that constant repoints fresh orgs and leaves every existing one pointing at the
 * SKU — the same half-migration trap documented on 110 and 114. The constant edit
 * still ships; this is its other half.
 *
 * ## Ordering
 *
 * MUST sort after 001, which creates the `vendor_part` def and both fields.
 * Naturally after 104 (which made the SKU optional), though there is no hard
 * dependency — 104 explains WHY this is needed, it does not gate it.
 *
 * Idempotent: a second run reads `up-to-date`, finds no nameless instances, and
 * writes nothing.
 */
export const migration115VendorPartDisplayPart: EntityMigration = {
  id: '115-vendor-part-display-part',
  description:
    'Point vendor_part displayName at the part (required) instead of vendorSku (optional), and backfill',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(VENDOR_PART_ENTITY_TYPE)
    if (!def) return { ...state, alreadyUpToDate: true }

    const partField = existing.fields.get(fieldKey(def.id, VENDOR_PART_PART_ATTRIBUTE))
    const skuField = existing.fields.get(fieldKey(def.id, VENDOR_PART_SKU_ATTRIBUTE))

    // Both legs are seeded by 001. A missing one means an org this migration has
    // nothing coherent to say about — leave it rather than half-linking.
    if (!partField || !skuField) return { ...state, alreadyUpToDate: true }

    const targets: DisplayTargets = { partFieldId: partField.id, skuFieldId: skuField.id }

    const [row] = await db
      .select({
        primaryDisplayFieldId: schema.EntityDefinition.primaryDisplayFieldId,
        secondaryDisplayFieldId: schema.EntityDefinition.secondaryDisplayFieldId,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, def.id))

    if (!row) return { ...state, alreadyUpToDate: true }

    const action = resolveDisplayRelink(row, targets)

    if (action === 'skip') {
      logger.debug('Migration 115 skipped — display pointer is customized', {
        organizationId,
        primaryDisplayFieldId: row.primaryDisplayFieldId,
      })
      return { ...state, alreadyUpToDate: true }
    }

    if (action === 'up-to-date') {
      // Repair arm — see `countNamelessInstances`.
      const nameless = await countNamelessInstances(db, organizationId, def.id)
      if (nameless === 0) return { ...state, alreadyUpToDate: true }

      await relinkAndBackfill(db, organizationId, def.id, targets, false)
      logger.info('Migration 115 repaired an unfinished backfill', { organizationId, nameless })
      return { ...state, alreadyUpToDate: false }
    }

    await relinkAndBackfill(db, organizationId, def.id, targets, true)

    logger.info('Migration 115 applied', {
      organizationId,
      entityDefinitionId: def.id,
      primaryDisplayFieldId: targets.partFieldId,
      secondaryDisplayFieldId: targets.skuFieldId,
    })

    return { ...state, alreadyUpToDate: false }
  },
}

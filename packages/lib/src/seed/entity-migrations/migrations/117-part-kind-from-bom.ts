// packages/lib/src/seed/entity-migrations/migrations/117-part-kind-from-bom.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { promoteUnclassifiedParts } from '../../../field-hooks/post/part-kind-derivation'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:117')

/**
 * Migration 117: give every part that already has a bill of materials the
 * `part_kind` the derivation would have given it
 * (plans/money/tasks/23-build-from-the-part.md §4.4).
 *
 * ## Why a backfill at all
 *
 * The rule this completes fires on `mfg-subparts-created`, so it only ever sees
 * NEW subpart edges. Every part whose BOM was entered before the rule existed
 * would keep whatever `part_kind` it had — which, in four of the five orgs
 * measured on 2026-08-31, was NULL on every single part. `resolvePartKind` reads
 * NULL as `component`, so those parts stayed unbuildable and the refusal told
 * the user to go set a field.
 *
 * Measured blast radius at the time of writing: **4 parts**, across MagnusCorp,
 * Kunstler and Kopilot Test. DemoOrg1 needs nothing, and that is also the check
 * that this is right — it must be a no-op on all 244 of its parts, because a
 * human classified every one of them and the graph agreed 244 times out of 244.
 *
 * ## The rule, once
 *
 * `promoteUnclassifiedParts` is the SAME function the native rule handler calls,
 * so a part promoted at write time and a part promoted here cannot be promoted
 * by two different rules. It writes `subassembly` where the stored kind is unset
 * or `component`, and touches nothing else — a `subassembly` stays, a
 * `finished_good` stays, and an unrecognised value belongs to whoever added it.
 *
 * 🛑 **Promotion only, and never to `finished_good`.** The reasoning is in
 * `field-hooks/post/part-kind-derivation.ts`: `finished_good` is the only kind
 * that maps to `INVENTORY_FINISHED_GOODS`, and this migration must not move
 * where any part posts. `component` and `subassembly` share an account, so it
 * moves no money.
 *
 * ⚠️ It DOES turn on `absorbsConversionCost` for the parts it touches, so their
 * standard cost changes at the next roll. That is the point — a part with a BOM
 * that absorbed no labour or overhead was understating its own standard — but it
 * is why this lands after migration 116 rather than beside it.
 *
 * Idempotent: a re-run finds every part already carrying a built kind and
 * promotes nothing.
 */
export const migration117PartKindFromBom: EntityMigration = {
  id: '117-part-kind-from-bom',
  description:
    'Set part_kind to subassembly on every unclassified part that has a bill of materials',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const parentPartIds = await readPartsWithABom(db, organizationId)
    if (parentPartIds.length === 0) return { ...state, alreadyUpToDate: true }

    const promoted = await promoteUnclassifiedParts(organizationId, parentPartIds, db)

    const alreadyUpToDate = promoted.length === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 117 applied', {
        organizationId,
        partsWithABom: parentPartIds.length,
        promoted: promoted.length,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Every part that is the parent of at least one live subpart edge.
 *
 * The edge's own instance must be unarchived: a soft-deleted subpart keeps its
 * `FieldValue` rows (which is what makes the delete trigger able to resolve its
 * parent at all), so reading the values alone would promote a part whose bill of
 * materials was removed.
 */
async function readPartsWithABom(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ parentPartId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'subpart_parent_part'),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const partIds = rows.map((r) => r.parentPartId).filter((id): id is string => id != null)
  if (partIds.length === 0) return []

  // The parent must itself still exist and be unarchived — a dangling relation
  // value is a hygiene question, not something to write a field onto.
  const live = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...new Set(partIds)]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  return live.map((row) => row.id)
}

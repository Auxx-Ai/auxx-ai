// packages/lib/src/inventory/receiving/movement-coverage.ts
// Which parts have ever moved, and which carry an `initial`, without scanning every movement.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { StockMovementType } from '../../resources/registry/enum-values'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { systemFieldMap } from '../../resources/system-records'

const MOVEMENT_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_part',
  'stock_movement_type',
] as const)

/**
 * Every part with at least one `stock_movement`, archived movements included (a soft-deleted
 * movement still happened). Reads `FieldValue` only: a movement's values go with its instance.
 */
export async function readPartsWithMovements(
  db: Database,
  organizationId: string
): Promise<Set<string>> {
  const fields = await systemFieldMap(db, organizationId, MOVEMENT_PICK)
  const partFieldId = fields.stock_movement_part?.id
  const parts = new Set<string>()
  if (!partFieldId) return parts

  // Loose index scan: one descent of (organizationId, fieldId, relatedEntityId) per distinct part,
  // instead of reading every movement's row (plain DISTINCT reads all of them on Postgres < 18).
  const result = await db.execute(sql`
    WITH RECURSIVE moved AS (
      (SELECT "relatedEntityId" AS id FROM "FieldValue"
        WHERE "organizationId" = ${organizationId} AND "fieldId" = ${partFieldId}
          AND "relatedEntityId" IS NOT NULL
        ORDER BY "relatedEntityId" LIMIT 1)
      UNION ALL
      SELECT (SELECT "relatedEntityId" FROM "FieldValue"
        WHERE "organizationId" = ${organizationId} AND "fieldId" = ${partFieldId}
          AND "relatedEntityId" > moved.id
        ORDER BY "relatedEntityId" LIMIT 1)
      FROM moved WHERE moved.id IS NOT NULL
    )
    SELECT id FROM moved WHERE id IS NOT NULL
  `)
  for (const row of result.rows as { id: string | null }[]) if (row.id) parts.add(row.id)
  return parts
}

/** Every part with at least one `initial` movement, archived included. Driven from the few `initial` rows. */
export async function readPartsWithInitialMovement(
  db: Database,
  organizationId: string
): Promise<Set<string>> {
  const fields = await systemFieldMap(db, organizationId, MOVEMENT_PICK)
  const partFieldId = fields.stock_movement_part?.id
  const typeFieldId = fields.stock_movement_type?.id
  const parts = new Set<string>()
  if (!partFieldId || !typeFieldId) return parts

  const typeValue = alias(schema.FieldValue, 'mc_type')
  const partValue = alias(schema.FieldValue, 'mc_part')
  const rows = await db
    .selectDistinct({ partId: partValue.relatedEntityId })
    .from(typeValue)
    .innerJoin(
      partValue,
      and(eq(partValue.entityId, typeValue.entityId), eq(partValue.fieldId, partFieldId))
    )
    .where(
      and(
        eq(typeValue.organizationId, organizationId),
        eq(typeValue.fieldId, typeFieldId),
        // A SINGLE_SELECT stores a system-seeded enum's value as its `optionId`.
        eq(typeValue.optionId, StockMovementType.INITIAL)
      )
    )
  for (const row of rows) if (row.partId) parts.add(row.partId)
  return parts
}

// packages/lib/src/inventory/costing/dated-reads.ts

/**
 * Dated reads over the movement ledger, per part (111 D23 / Q26).
 *
 * Same rows `batchRecalculateQoH` sums — `adjust_subparts = true` rows excluded — but keyed on
 * a movement date: `COALESCE(stock_movement_occurred_at, EntityInstance.createdAt)`, so a row
 * written without a date still counts from the moment it was written.
 */

import { database, schema } from '@auxx/database'
import { and, eq, inArray, notInArray, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { systemFieldMap } from '../../resources/system-records'

const LEDGER_PICK = [
  'stock_movement_quantity',
  'stock_movement_part',
  'stock_movement_adjust_subparts',
  'stock_movement_occurred_at',
] as const

/** Net quantity per part over every movement dated on or before `through`. Absent parts read `0`. */
export async function readPartNetThrough(
  organizationId: string,
  partIds: readonly string[],
  through: Date
): Promise<Map<string, number>> {
  const unique = [...new Set(partIds)]
  const result = new Map<string, number>(unique.map((id) => [id, 0]))
  if (unique.length === 0) return result

  const rows = await aggregatePerPart(organizationId, unique, {
    aggregate: (q) => sql<string>`COALESCE(SUM(${q.valueNumber}), 0)`,
    where: (movedAt) => sql`${movedAt} <= ${through}`,
  })
  for (const row of rows) {
    if (row.partId) result.set(row.partId, Number(row.value ?? 0))
  }
  return result
}

/**
 * The earliest movement date per part, or `null` for a part with no movements.
 * `excludeMovementIds` leaves rows out, so a re-anchor never measures an `initial` against itself.
 */
export async function readEarliestMovementAt(
  organizationId: string,
  partIds: readonly string[],
  options: { excludeMovementIds?: readonly string[] } = {}
): Promise<Map<string, Date | null>> {
  const unique = [...new Set(partIds)]
  const result = new Map<string, Date | null>(unique.map((id) => [id, null]))
  if (unique.length === 0) return result

  const excluded = [...new Set(options.excludeMovementIds ?? [])]
  const rows = await aggregatePerPart(organizationId, unique, {
    aggregate: (_q, movedAt) => sql<string | Date | null>`MIN(${movedAt})`,
    where: (_movedAt, qty) =>
      excluded.length > 0 ? notInArray(qty.entityId, excluded) : sql`TRUE`,
  })
  for (const row of rows) {
    if (!row.partId || row.value == null) continue
    const date = row.value instanceof Date ? row.value : new Date(row.value)
    result.set(row.partId, Number.isNaN(date.getTime()) ? null : date)
  }
  return result
}

type QuantityValue = ReturnType<typeof alias<typeof schema.FieldValue, 'dated_qty'>>

/** One grouped aggregate over the part's counted movements; `movedAt` is the COALESCEd date. */
async function aggregatePerPart<T>(
  organizationId: string,
  partIds: string[],
  shape: {
    aggregate: (qty: QuantityValue, movedAt: SQL) => SQL<T>
    where: (movedAt: SQL, qty: QuantityValue) => SQL
  }
): Promise<Array<{ partId: string | null; value: T }>> {
  const fields = await systemFieldMap(undefined, organizationId, LEDGER_PICK)
  const qtyField = fields.stock_movement_quantity
  const partField = fields.stock_movement_part
  if (!qtyField || !partField) return []

  const qty = alias(schema.FieldValue, 'dated_qty')
  const part = alias(schema.FieldValue, 'dated_part')
  const flag = alias(schema.FieldValue, 'dated_flag')
  const occurred = alias(schema.FieldValue, 'dated_occurred')
  const movedAt = sql`COALESCE(${occurred.valueDate}, ${schema.EntityInstance.createdAt})`

  return database
    .select({ partId: part.relatedEntityId, value: shape.aggregate(qty, movedAt) })
    .from(qty)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, qty.entityId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .innerJoin(
      part,
      and(
        eq(part.entityId, qty.entityId),
        eq(part.fieldId, partField.id),
        eq(part.organizationId, organizationId),
        inArray(part.relatedEntityId, partIds)
      )
    )
    .leftJoin(
      flag,
      and(
        eq(flag.entityId, qty.entityId),
        eq(flag.fieldId, fields.stock_movement_adjust_subparts?.id ?? ''),
        eq(flag.organizationId, organizationId)
      )
    )
    .leftJoin(
      occurred,
      and(
        eq(occurred.entityId, qty.entityId),
        eq(occurred.fieldId, fields.stock_movement_occurred_at?.id ?? ''),
        eq(occurred.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(qty.fieldId, qtyField.id),
        eq(qty.organizationId, organizationId),
        sql`(${flag.valueBoolean} IS NULL OR ${flag.valueBoolean} = false)`,
        shape.where(movedAt, qty)
      )
    )
    .groupBy(part.relatedEntityId)
}

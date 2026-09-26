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
 * {@link readPartNetThrough} at every instant of `throughs` (ascending), in ONE grouped read:
 * entry `i` equals `readPartNetThrough(org, partIds, throughs[i])`.
 */
export async function readPartNetThroughEach(
  organizationId: string,
  partIds: readonly string[],
  throughs: readonly Date[]
): Promise<Map<string, number>[]> {
  const unique = [...new Set(partIds)]
  const result = throughs.map(() => new Map<string, number>(unique.map((id) => [id, 0])))
  const last = throughs.at(-1)
  if (unique.length === 0 || !last) return result
  for (let i = 1; i < throughs.length; i += 1) {
    if ((throughs[i] as Date).getTime() < (throughs[i - 1] as Date).getTime()) {
      throw new Error('readPartNetThroughEach needs ascending instants')
    }
  }

  // Inlined, not bound: GROUP BY must repeat the select's expression verbatim, and `toISOString` output is safe.
  const bounds = sql.raw(
    `ARRAY[${throughs.map((t) => `'${t.toISOString()}'`).join(',')}]::timestamptz[]`
  )
  const rows = await aggregatePerPart(organizationId, unique, {
    aggregate: (q) => sql<string>`COALESCE(SUM(${q.valueNumber}), 0)`,
    where: (movedAt) => sql`${movedAt} <= ${last}`,
    // Bucket k = how many bounds lie strictly before the movement (µs-exact), so `<= throughs[j]` is k <= j.
    bucket: (movedAt) =>
      sql<number>`width_bucket(${movedAt} - interval '1 microsecond', ${bounds})`,
  })
  for (const row of rows) {
    if (!row.partId) continue
    const quantity = Number(row.value ?? 0)
    for (let j = Number(row.bucket ?? 0); j < result.length; j += 1) {
      const net = result[j] as Map<string, number>
      net.set(row.partId, (net.get(row.partId) ?? 0) + quantity)
    }
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

/** The latest movement date per part, or `null` for a part with no movements. One grouped read. */
export async function readLatestMovementAt(
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, Date | null>> {
  const unique = [...new Set(partIds)]
  const result = new Map<string, Date | null>(unique.map((id) => [id, null]))
  if (unique.length === 0) return result

  const rows = await aggregatePerPart(organizationId, unique, {
    aggregate: (_q, movedAt) => sql<string | Date | null>`MAX(${movedAt})`,
    where: () => sql`TRUE`,
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
    /** A second grouping key per part, e.g. a date bucket. */
    bucket?: (movedAt: SQL) => SQL<number>
  }
): Promise<Array<{ partId: string | null; value: T; bucket?: number }>> {
  const fields = await systemFieldMap(undefined, organizationId, LEDGER_PICK)
  const qtyField = fields.stock_movement_quantity
  const partField = fields.stock_movement_part
  if (!qtyField || !partField) return []

  const qty = alias(schema.FieldValue, 'dated_qty')
  const part = alias(schema.FieldValue, 'dated_part')
  const flag = alias(schema.FieldValue, 'dated_flag')
  const occurred = alias(schema.FieldValue, 'dated_occurred')
  const movedAt = sql`COALESCE(${occurred.valueDate}, ${schema.EntityInstance.createdAt})`
  const bucket = shape.bucket?.(movedAt)

  return database
    .select({
      partId: part.relatedEntityId,
      value: shape.aggregate(qty, movedAt),
      ...(bucket ? { bucket } : {}),
    })
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
    .groupBy(...(bucket ? [part.relatedEntityId, bucket] : [part.relatedEntityId]))
}

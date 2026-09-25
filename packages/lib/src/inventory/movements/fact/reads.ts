// packages/lib/src/inventory/movements/fact/reads.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, count, eq, inArray, type SQL, sql, sum } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { chunkArray } from '../../../import/utils/chunk-array'
import { StockMovementType } from '../../../resources/registry/enum-values'
import { guard } from '../guard'
import type { ConsumptionClass } from './classify'

const F = schema.InventoryMovementFact
const ID_CHUNK = 500

type Db = Database | Transaction

/** A day range in the org's book time zone: `from`/`to` are inclusive `YYYY-MM-DD` keys, `zone` an IANA name. */
export interface FactDayRange {
  from: string
  to: string
  zone: string
}

/** One part on one book day. Quantities are positive for consumption and scrap. */
export interface DailySeriesRow {
  partId: string
  day: string
  consumed: number
  scrapped: number
  net: number
  onHandEod: number
}

/** One part in one book month. */
export interface UsageBucketRow {
  partId: string
  month: string
  consumed: number
  scrapped: number
  /** Days ending at or below zero with nothing consumed (02 §6.1). */
  stockoutDays: number
}

/** One receipt against a PO line. */
export interface PoLineReceiptRow {
  movementId: string
  purchaseOrderLineId: string
  occurredAt: Date
  quantity: number
}

/** A component's `build_consume` quantity attributed to one produced part, and its share of the component's total. */
export interface WhereUsedShareRow {
  componentId: string
  producedPartId: string
  quantity: number
  share: number
}

/** One part on one book day with any sale, produce or consume row: positive quantities and row counts. */
export interface DailyActivityRow {
  partId: string
  day: string
  /** `sale` + `ship`. */
  saleQty: number
  saleCount: number
  produceQty: number
  produceCount: number
  consumeQty: number
  consumeCount: number
}

/** Count and signed sum of one part's mirror rows. */
export interface FactTotals {
  count: number
  sum: number
}

/** `(day::timestamp AT TIME ZONE zone)`: the instant a book day starts. */
function dayStart(dayKey: SQL, zone: string): SQL {
  return sql`((${dayKey})::timestamp AT TIME ZONE ${zone})`
}

/** The dense per-part, per-day CTE both series reads select from (02 §6.1). */
function seriesCte(organizationId: string, partIds: readonly string[], range: FactDayRange): SQL {
  const { from, to, zone } = range
  const fromInstant = dayStart(sql`${from}::date`, zone)
  const toInstant = dayStart(sql`${to}::date + 1`, zone)
  return sql`
    WITH parts AS (SELECT unnest(${sql.param([...partIds])}::text[]) AS "partId"),
    days AS (
      SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
    ),
    opening AS (
      SELECT ${F.partId} AS "partId", SUM(${F.quantity}) AS qty
      FROM ${F}
      WHERE ${F.organizationId} = ${organizationId}
        AND ${F.partId} = ANY(${sql.param([...partIds])}::text[])
        AND ${F.occurredAt} < ${fromInstant}
      GROUP BY 1
    ),
    agg AS (
      SELECT ${F.partId} AS "partId",
             (${F.occurredAt} AT TIME ZONE ${zone})::date AS day,
             SUM(-${F.quantity}) FILTER (WHERE ${F.consumptionClass} = 'consumption') AS consumed,
             SUM(-${F.quantity}) FILTER (WHERE ${F.consumptionClass} = 'scrap') AS scrapped,
             SUM(${F.quantity}) AS net
      FROM ${F}
      WHERE ${F.organizationId} = ${organizationId}
        AND ${F.partId} = ANY(${sql.param([...partIds])}::text[])
        AND ${F.occurredAt} >= ${fromInstant}
        AND ${F.occurredAt} < ${toInstant}
      GROUP BY 1, 2
    ),
    series AS (
      SELECT p."partId", d.day,
             COALESCE(a.consumed, 0) AS consumed,
             COALESCE(a.scrapped, 0) AS scrapped,
             COALESCE(a.net, 0) AS net,
             COALESCE(o.qty, 0)
               + SUM(COALESCE(a.net, 0)) OVER (PARTITION BY p."partId" ORDER BY d.day) AS "onHandEod"
      FROM parts p
      CROSS JOIN days d
      LEFT JOIN agg a ON a."partId" = p."partId" AND a.day = d.day
      LEFT JOIN opening o ON o."partId" = p."partId"
    )`
}

/** Per part per book day: consumed, scrapped, net and end-of-day on hand replayed from the mirror. */
export async function readDailySeries(
  db: Db,
  organizationId: string,
  input: { partIds: readonly string[] } & FactDayRange
): Promise<Result<DailySeriesRow[], Error>> {
  return guard(
    async () => {
      if (input.partIds.length === 0) return []
      // Aggregate over a dense day range: generate_series and a window SUM have no query-builder form.
      const result = await db.execute(sql`
        ${seriesCte(organizationId, input.partIds, input)}
        SELECT "partId", to_char(day, 'YYYY-MM-DD') AS day,
               consumed::float8 AS consumed, scrapped::float8 AS scrapped,
               net::float8 AS net, "onHandEod"::float8 AS "onHandEod"
        FROM series
        ORDER BY "partId", day
      `)
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        partId: String(row.partId),
        day: String(row.day),
        consumed: Number(row.consumed),
        scrapped: Number(row.scrapped),
        net: Number(row.net),
        onHandEod: Number(row.onHandEod),
      }))
    },
    'Failed to read the daily movement series',
    { organizationId, parts: input.partIds.length }
  )
}

/** Per part per book month: consumed, scrapped and stockout days, for seasonality (02 §6.5). */
export async function readUsageBuckets(
  db: Db,
  organizationId: string,
  input: { partIds: readonly string[]; grain: 'month' } & FactDayRange
): Promise<Result<UsageBucketRow[], Error>> {
  return guard(
    async () => {
      if (input.partIds.length === 0) return []
      // Stockout days need the replayed daily on hand, so the months group the same dense series.
      const result = await db.execute(sql`
        ${seriesCte(organizationId, input.partIds, input)}
        SELECT "partId", to_char(day, 'YYYY-MM') AS month,
               SUM(consumed)::float8 AS consumed,
               SUM(scrapped)::float8 AS scrapped,
               COUNT(*) FILTER (WHERE "onHandEod" <= 0 AND consumed = 0)::int AS "stockoutDays"
        FROM series
        GROUP BY 1, 2
        ORDER BY 1, 2
      `)
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        partId: String(row.partId),
        month: String(row.month),
        consumed: Number(row.consumed),
        scrapped: Number(row.scrapped),
        stockoutDays: Number(row.stockoutDays),
      }))
    },
    'Failed to read the monthly usage buckets',
    { organizationId, parts: input.partIds.length }
  )
}

/** Every `receive` row against these PO lines, oldest first (02 §6.2). */
export async function readReceiptsForPoLines(
  db: Db,
  organizationId: string,
  poLineIds: readonly string[]
): Promise<Result<PoLineReceiptRow[], Error>> {
  return guard(
    async () => {
      const out: PoLineReceiptRow[] = []
      for (const chunk of chunkArray([...new Set(poLineIds)], ID_CHUNK)) {
        const rows = await db
          .select({
            movementId: F.id,
            purchaseOrderLineId: F.purchaseOrderLineId,
            occurredAt: F.occurredAt,
            quantity: F.quantity,
          })
          .from(F)
          .where(
            and(
              eq(F.organizationId, organizationId),
              eq(F.type, StockMovementType.RECEIVE),
              inArray(F.purchaseOrderLineId, chunk)
            )
          )
          .orderBy(asc(F.occurredAt), asc(F.id))
        for (const row of rows) {
          out.push({ ...row, purchaseOrderLineId: row.purchaseOrderLineId as string })
        }
      }
      return out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    },
    'Failed to read receipts for purchase order lines',
    { organizationId, lines: poLineIds.length }
  )
}

/** For each component, how its `build_consume` splits across the parts its builds produced (02 §7a). */
export async function readWhereUsedShares(
  db: Db,
  organizationId: string,
  partIds: readonly string[],
  range: FactDayRange
): Promise<Result<WhereUsedShareRow[], Error>> {
  return guard(
    async () => {
      if (partIds.length === 0) return []
      const fromInstant = dayStart(sql`${range.from}::date`, range.zone)
      const toInstant = dayStart(sql`${range.to}::date + 1`, range.zone)
      // An aggregate over a self-join through buildId, with a window share: no query-builder form.
      const result = await db.execute(sql`
        WITH produced AS (
          SELECT DISTINCT ${F.buildId} AS "buildId", ${F.partId} AS "partId"
          FROM ${F}
          WHERE ${F.organizationId} = ${organizationId}
            AND ${F.type} = ${StockMovementType.BUILD_PRODUCE}
            AND ${F.buildId} IS NOT NULL
        ),
        used AS (
          SELECT ${F.partId} AS "componentId", produced."partId" AS "producedPartId",
                 SUM(-${F.quantity}) AS qty
          FROM ${F}
          JOIN produced ON produced."buildId" = ${F.buildId}
          WHERE ${F.organizationId} = ${organizationId}
            AND ${F.type} = ${StockMovementType.BUILD_CONSUME}
            AND ${F.partId} = ANY(${sql.param([...partIds])}::text[])
            AND ${F.occurredAt} >= ${fromInstant}
            AND ${F.occurredAt} < ${toInstant}
          GROUP BY 1, 2
        )
        SELECT "componentId", "producedPartId", qty::float8 AS quantity,
               COALESCE(qty / NULLIF(SUM(qty) OVER (PARTITION BY "componentId"), 0), 0)::float8 AS share
        FROM used
        ORDER BY 1, 2
      `)
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        componentId: String(row.componentId),
        producedPartId: String(row.producedPartId),
        quantity: Number(row.quantity),
        share: Number(row.share),
      }))
    },
    'Failed to read where-used shares',
    { organizationId, parts: partIds.length }
  )
}

/** Per part per book day: sale, produce and consume quantities and row counts (sparse; days with none are absent). */
export async function readDailyActivity(
  db: Db,
  organizationId: string,
  input: { partIds: readonly string[] } & FactDayRange
): Promise<Result<DailyActivityRow[], Error>> {
  return guard(
    async () => {
      if (input.partIds.length === 0) return []
      const fromInstant = dayStart(sql`${input.from}::date`, input.zone)
      const toInstant = dayStart(sql`${input.to}::date + 1`, input.zone)
      const sale = sql`${F.type} IN (${StockMovementType.SALE}, ${StockMovementType.SHIP})`
      const produce = sql`${F.type} = ${StockMovementType.BUILD_PRODUCE}`
      const consume = sql`${F.type} = ${StockMovementType.BUILD_CONSUME}`
      // Aggregate per book day with FILTERs; reversals and exploded children are left out, these are shape signals, not totals.
      const result = await db.execute(sql`
        SELECT ${F.partId} AS "partId",
               to_char((${F.occurredAt} AT TIME ZONE ${input.zone})::date, 'YYYY-MM-DD') AS day,
               COALESCE(SUM(-${F.quantity}) FILTER (WHERE ${sale}), 0)::float8 AS "saleQty",
               COUNT(*) FILTER (WHERE ${sale})::int AS "saleCount",
               COALESCE(SUM(${F.quantity}) FILTER (WHERE ${produce}), 0)::float8 AS "produceQty",
               COUNT(*) FILTER (WHERE ${produce})::int AS "produceCount",
               COALESCE(SUM(-${F.quantity}) FILTER (WHERE ${consume}), 0)::float8 AS "consumeQty",
               COUNT(*) FILTER (WHERE ${consume})::int AS "consumeCount"
        FROM ${F}
        WHERE ${F.organizationId} = ${organizationId}
          AND ${F.partId} = ANY(${sql.param([...input.partIds])}::text[])
          AND ${F.occurredAt} >= ${fromInstant}
          AND ${F.occurredAt} < ${toInstant}
          AND ${F.reversesMovementId} IS NULL
          AND ${F.parentMovementId} IS NULL
          AND (${sale} OR ${produce} OR ${consume})
        GROUP BY 1, 2
        ORDER BY 1, 2
      `)
      return (result.rows as Record<string, unknown>[]).map((row) => ({
        partId: String(row.partId),
        day: String(row.day),
        saleQty: Number(row.saleQty),
        saleCount: Number(row.saleCount),
        produceQty: Number(row.produceQty),
        produceCount: Number(row.produceCount),
        consumeQty: Number(row.consumeQty),
        consumeCount: Number(row.consumeCount),
      }))
    },
    'Failed to read daily movement activity',
    { organizationId, parts: input.partIds.length }
  )
}

/** Count and signed sum of the mirror per part, for the drift check. */
export async function readFactTotalsByPart(
  db: Db,
  organizationId: string
): Promise<Map<string, FactTotals>> {
  // Aggregate: one grouped count and SUM per part.
  const rows = await db
    .select({ partId: F.partId, n: count(), total: sum(F.quantity) })
    .from(F)
    .where(eq(F.organizationId, organizationId))
    .groupBy(F.partId)
  return new Map(rows.map((row) => [row.partId, { count: row.n, sum: Number(row.total ?? 0) }]))
}

/** The stored class of each of these movements that the mirror holds. */
export async function readMovementFactClasses(
  db: Db,
  organizationId: string,
  ids: readonly string[]
): Promise<Map<string, ConsumptionClass>> {
  const out = new Map<string, ConsumptionClass>()
  for (const chunk of chunkArray([...new Set(ids)], ID_CHUNK)) {
    const rows = await db
      .select({ id: F.id, consumptionClass: F.consumptionClass })
      .from(F)
      .where(and(eq(F.organizationId, organizationId), inArray(F.id, chunk)))
    for (const row of rows) out.set(row.id, row.consumptionClass)
  }
  return out
}

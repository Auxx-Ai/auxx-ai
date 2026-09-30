// packages/lib/src/inventory/movements/reads.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, lt, lte, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { chunkArray } from '../../import/utils/chunk-array'
import { type ConsumptionClass, classifyMovementRows, type MovementClassRow } from './classify'

type Db = Database | Transaction

const ID_CHUNK = 1000

/** One `StockMovement` row. Amounts are integer minor units; rates are minor units with 3 decimals. */
export type StockMovementRow = typeof schema.StockMovement.$inferSelect

/** An upper bound on `effectiveAt`; `inclusive: false` reads strictly before it. */
export interface EffectiveAtBound {
  before: Date
  inclusive?: boolean
}

function effectiveBound(bound: EffectiveAtBound | undefined): SQL | undefined {
  if (!bound) return undefined
  const col = schema.StockMovement.effectiveAt
  return bound.inclusive === false ? lt(col, bound.before) : lte(col, bound.before)
}

/** Rows whose `column` is in `ids`, chunked, ordered by `effectiveAt` then `createdAt` within each chunk. */
async function readByColumn(
  db: Db,
  organizationId: string,
  column: PgColumn,
  ids: readonly string[],
  extra?: SQL
): Promise<StockMovementRow[]> {
  const t = schema.StockMovement
  const out: StockMovementRow[] = []
  for (const chunk of chunkArray([...new Set(ids)], ID_CHUNK)) {
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.organizationId, organizationId), inArray(column, chunk), extra))
      .orderBy(asc(t.effectiveAt), asc(t.createdAt), asc(t.id))
    out.push(...rows)
  }
  return out
}

/** Movements by id; ids that do not exist are simply absent. */
export async function readMovementsByIds(
  db: Db,
  organizationId: string,
  ids: readonly string[]
): Promise<StockMovementRow[]> {
  return readByColumn(db, organizationId, schema.StockMovement.id, ids)
}

/** Each movement's class: its stamped column, else a replay through its reversal chain (pre-203 rows). */
export async function readConsumptionClasses(
  db: Db,
  organizationId: string,
  ids: readonly string[]
): Promise<Map<string, ConsumptionClass>> {
  const t = schema.StockMovement
  const rows = new Map<string, MovementClassRow>()
  let pending = [...new Set(ids)]
  while (pending.length > 0) {
    const next: string[] = []
    for (const chunk of chunkArray(pending, ID_CHUNK)) {
      const read = await db
        .select({
          id: t.id,
          type: t.type,
          reversesMovementId: t.reversesMovementId,
          parentMovementId: t.parentMovementId,
          consumptionClass: t.consumptionClass,
        })
        .from(t)
        .where(and(eq(t.organizationId, organizationId), inArray(t.id, chunk)))
      for (const row of read) {
        rows.set(row.id, row)
        const original = row.reversesMovementId
        if (!row.consumptionClass && original && !rows.has(original)) next.push(original)
      }
    }
    pending = [...new Set(next)].filter((id) => !rows.has(id))
  }
  const classes = classifyMovementRows([...rows.values()])
  return new Map(ids.flatMap((id) => (classes.has(id) ? [[id, classes.get(id)!] as const] : [])))
}

/** One movement by id, or `undefined`. */
export async function readMovementById(
  db: Db,
  organizationId: string,
  id: string
): Promise<StockMovementRow | undefined> {
  const [row] = await readMovementsByIds(db, organizationId, [id])
  return row
}

/** Every movement of the given parts, in ledger order, optionally bounded on `effectiveAt`. */
export async function readMovementsByParts(
  db: Db,
  organizationId: string,
  partIds: readonly string[],
  options: { effectiveAt?: EffectiveAtBound } = {}
): Promise<StockMovementRow[]> {
  return readByColumn(
    db,
    organizationId,
    schema.StockMovement.partId,
    partIds,
    effectiveBound(options.effectiveAt)
  )
}

/** Every movement linked to the given builds: their consume and produce legs. */
export async function readMovementsByBuilds(
  db: Db,
  organizationId: string,
  buildIds: readonly string[]
): Promise<StockMovementRow[]> {
  return readByColumn(db, organizationId, schema.StockMovement.buildId, buildIds)
}

/** Every movement linked to the given purchase order lines (receipts and their reversals). */
export async function readMovementsByPurchaseOrderLines(
  db: Db,
  organizationId: string,
  purchaseOrderLineIds: readonly string[]
): Promise<StockMovementRow[]> {
  return readByColumn(
    db,
    organizationId,
    schema.StockMovement.purchaseOrderLineId,
    purchaseOrderLineIds
  )
}

/** Every movement linked to the given fulfillment lines (relief and its reversals). */
export async function readMovementsByFulfillmentLines(
  db: Db,
  organizationId: string,
  fulfillmentLineIds: readonly string[]
): Promise<StockMovementRow[]> {
  return readByColumn(
    db,
    organizationId,
    schema.StockMovement.fulfillmentLineId,
    fulfillmentLineIds
  )
}

/** The reversals pointing at the given movements; at most one each (unique index). */
export async function readReversalsOf(
  db: Db,
  organizationId: string,
  movementIds: readonly string[]
): Promise<StockMovementRow[]> {
  return readByColumn(db, organizationId, schema.StockMovement.reversesMovementId, movementIds)
}

/**
 * Movements still waiting for a cost (`costBasis = 'pending'`), scoped by part or by build.
 * Exactly one scope is required so no caller reads a whole org's pending rows by accident.
 */
export async function readPendingMovements(
  db: Db,
  organizationId: string,
  scope: { partIds: readonly string[] } | { buildIds: readonly string[] }
): Promise<StockMovementRow[]> {
  const t = schema.StockMovement
  const pending = eq(t.costBasis, 'pending')
  return 'partIds' in scope
    ? readByColumn(db, organizationId, t.partId, scope.partIds, pending)
    : readByColumn(db, organizationId, t.buildId, scope.buildIds, pending)
}

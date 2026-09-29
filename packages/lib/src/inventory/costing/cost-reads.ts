// packages/lib/src/inventory/costing/cost-reads.ts

/**
 * The two reads brief 50 §3 needs before a relief movement's cost can be
 * frozen. Both are pure reads - no writer lives here, and neither is gated on
 * any lane (plain, quiet, or otherwise); the caller decides how to use the
 * numbers.
 *
 * 🛑 **{@link readPartLedgerAverages} no longer prices relief** (73 §6.2 rule
 * 3). 50 §3.1-§3.3 ruled out the standard because a roll's revaluation delta
 * was never posted, so relieving at standard left a residue on every unit
 * shipped after one; 73 §6.2 rule 2 posts that delta, which removes the
 * objection. Relief is at the standard with its material / labour / overhead
 * split, and this read stays as a REPORT of what an account holds per unit -
 * plus the live on-hand quantity `relieve.ts` predicts a negative shelf from.
 *
 * {@link readFulfillmentLineRelievedAverages} is unchanged and still the basis
 * for a down-delta (50 §3.5): an un-relieving row is priced at what THIS
 * fulfillment line was actually relieved at, never at today's figure, or a
 * quantity correction makes inventory value appear out of a channel that never
 * held it.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { guard } from './guard'
import type { FulfillmentLineRelievedAverage, PartLedgerAverage } from './types'

/**
 * Postgres' bound-parameter ceiling is 65535; each id in an `IN (...)` list is
 * one parameter. Chunking keeps a very large batch from ever approaching it
 * while staying at exactly one query for the common case (a run's distinct
 * parts or lines is almost always far below this). Every chunk's rows are
 * merged into the one Map the caller sees - the caller never knows chunking
 * happened.
 */
const MAX_IDS_PER_QUERY = 1000

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** `Number(...)`, normalizing a net-zero SUM's `-0` back to a plain `0`. */
function signedNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0) || 0
}

export interface ReadPartLedgerAveragesParams {
  organizationId: string
  partInstanceIds: string[]
}

/**
 * Signed `Σ extendedCostMinor` and `Σ quantity` per part over the rows QoH sums (`adjustSubparts`
 * excluded), in one statement so value and quantity share a row set (§3.4). A part with no
 * movements is absent from the Map.
 */
export async function readPartLedgerAverages(
  db: Database,
  params: ReadPartLedgerAveragesParams
): Promise<Result<Map<string, PartLedgerAverage>, Error>> {
  return guard(
    async () => {
      const { organizationId, partInstanceIds } = params
      const uniqueIds = [...new Set(partInstanceIds)]
      const result = new Map<string, PartLedgerAverage>()
      if (uniqueIds.length === 0) return result

      const t = schema.StockMovement
      for (const idChunk of chunk(uniqueIds, MAX_IDS_PER_QUERY)) {
        // A `pending` row (111 Q18) has no cost yet but still counts in the quantity.
        const rows = await db
          .select({
            partId: t.partId,
            quantity: sql<string>`COALESCE(SUM(${t.quantity}), 0)`,
            valueMinor: sql<string>`COALESCE(SUM(${t.extendedCostMinor}), 0)`,
          })
          .from(t)
          .where(
            and(
              eq(t.organizationId, organizationId),
              inArray(t.partId, idChunk),
              eq(t.adjustSubparts, false)
            )
          )
          .groupBy(t.partId)

        for (const row of rows) {
          const quantity = signedNumber(row.quantity)
          const valueMinor = signedNumber(row.valueMinor)
          result.set(row.partId, {
            partInstanceId: row.partId,
            valueMinor,
            quantity,
            unitCostMinor: quantity > 0 ? Math.round(valueMinor / quantity) : null,
          })
        }
      }

      return result
    },
    'Failed to read part ledger averages',
    { organizationId: params.organizationId, partCount: params.partInstanceIds.length }
  )
}

export interface ReadFulfillmentLineRelievedAveragesParams {
  organizationId: string
  fulfillmentLineIds: string[]
}

/**
 * What each fulfillment line has already been relieved at: `Σ extended cost / Σ quantity` over
 * its priced `sale` movements (§3.5), negated to positive. A reversed sale is `return_in` and never
 * counts, matching `fulfillment-line-rollups.ts`. A line with no sale rows is absent.
 */
export async function readFulfillmentLineRelievedAverages(
  db: Database,
  params: ReadFulfillmentLineRelievedAveragesParams
): Promise<Result<Map<string, FulfillmentLineRelievedAverage>, Error>> {
  return guard(
    async () => {
      const { organizationId, fulfillmentLineIds } = params
      const uniqueIds = [...new Set(fulfillmentLineIds)]
      const result = new Map<string, FulfillmentLineRelievedAverage>()
      if (uniqueIds.length === 0) return result

      const t = schema.StockMovement
      for (const idChunk of chunk(uniqueIds, MAX_IDS_PER_QUERY)) {
        // A `pending` row (111 Q18) has no cost to average, so its quantity must not dilute the priced rows'.
        const rows = await db
          .select({
            lineId: sql<string>`${t.fulfillmentLineId}`,
            quantity: sql<string>`COALESCE(SUM(${t.quantity}), 0)`,
            valueMinor: sql<string>`COALESCE(SUM(${t.extendedCostMinor}), 0)`,
          })
          .from(t)
          .where(
            and(
              eq(t.organizationId, organizationId),
              inArray(t.fulfillmentLineId, idChunk),
              eq(t.type, StockMovementType.SALE),
              isNotNull(t.extendedCostMinor),
              or(isNull(t.costBasis), ne(t.costBasis, StockMovementCostBasis.PENDING))
            )
          )
          .groupBy(t.fulfillmentLineId)

        for (const row of rows) {
          const relievedQuantity = -signedNumber(row.quantity) || 0
          const relievedValueMinor = -signedNumber(row.valueMinor) || 0
          result.set(row.lineId, {
            fulfillmentLineId: row.lineId,
            relievedQuantity,
            relievedValueMinor,
            unitCostMinor:
              relievedQuantity > 0 ? Math.round(relievedValueMinor / relievedQuantity) : null,
          })
        }
      }

      return result
    },
    'Failed to read fulfillment line relieved averages',
    {
      organizationId: params.organizationId,
      lineCount: params.fulfillmentLineIds.length,
    }
  )
}

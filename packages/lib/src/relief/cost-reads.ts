// packages/lib/src/relief/cost-reads.ts

/**
 * The two reads brief 50 §3 needs before a relief movement's cost can be
 * frozen. Both are pure reads - no writer lives here, and neither is gated on
 * any lane (plain, quiet, or otherwise); the caller decides how to use the
 * numbers.
 *
 * §3.1-§3.3 rules out `part_standard_cost` as the relief basis: a standard
 * roll's revaluation delta is never posted (`builds/standard-cost.ts:78`), so
 * relieving at current standard leaves a residue on every unit shipped after
 * a roll, and it accumulates invisibly. The basis instead is the part's own
 * ledger-derived average - {@link readPartLedgerAverages} - with one
 * exception, stated in §3.5: a down-delta (an un-relieving row) must be
 * priced at what THIS fulfillment line was actually relieved at, never at
 * today's average, or a quantity correction makes inventory value appear out
 * of a channel that never held it. That is {@link readFulfillmentLineRelievedAverages}.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { StockMovementType } from '../resources/registry/enum-values'
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
 * The signed sum of `stock_movement_extended_cost` and `stock_movement_quantity`
 * per part, over every movement EXCEPT one flagged `stock_movement_adjust_subparts`
 * - the same exclusion `batchRecalculateQoH` applies (`bom/qoh.ts`, its grouped
 * SUM), because those rows exist to be exploded into child movements and are
 * not the part's own consumption.
 *
 * 🛑 §3.4 is why this predicate is copied verbatim from `bom/qoh.ts` rather
 * than approximated: the numerator (value) and denominator (quantity) MUST be
 * computed from the identical row set QoH itself uses, in one statement under
 * one predicate, or a part with an exploded movement in its history gets a
 * wrong average. `part_quantity_on_hand` is deliberately NOT read as the
 * denominator - it is a cached re-SUM written after commit by a different
 * lane, one recalc behind during a batch (§3.4).
 *
 * ⚠️ A part whose `part_kind` changed has mixed accounts in its history; the
 * average is over the whole part regardless (§3.4). Accepted - the
 * alternative is lot costing by another name.
 *
 * Batched: one query for the whole `partInstanceIds` set (chunked only if the
 * set is large enough to risk Postgres' parameter ceiling - see
 * {@link MAX_IDS_PER_QUERY}). Empty input returns an empty Map without
 * touching the database. A part with no movements at all (never received,
 * never built) is ABSENT from the Map, not a zero row - the caller decides
 * what absence means (§3.6: fall back to `part_standard_cost` and warn).
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

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'stock_movement_part',
          'stock_movement_quantity',
          'stock_movement_extended_cost',
          'stock_movement_adjust_subparts',
        ] as const)

      const partField = fields.stock_movement_part
      const quantityField = fields.stock_movement_quantity
      const extendedCostField = fields.stock_movement_extended_cost
      // `adjust_subparts` is treated the same way `bom/qoh.ts` treats it: not
      // required to run the query. An org without the field provisioned has
      // no movement that could carry it flagged `true`, so the exclusion
      // predicate below degenerates to "flag join matches nothing" and every
      // movement counts - which is correct, not a silent gap.
      const flagFieldId = fields.stock_movement_adjust_subparts?.id ?? ''

      if (!partField || !quantityField || !extendedCostField) {
        throw new UnprocessableEntityError(
          'This organization has no stock_movement part/quantity/extended-cost fields provisioned'
        )
      }

      for (const idChunk of chunk(uniqueIds, MAX_IDS_PER_QUERY)) {
        const idList = sql.join(
          idChunk.map((id) => sql`${id}`),
          sql`, `
        )

        // Base row = the movement's `quantity` FieldValue. `fv_part` carries
        // the part relationship and restricts to this chunk's ids; `fv_cost`
        // is the same movement's `extended_cost` FieldValue, joined so both
        // sums come from ONE grouped statement; `fv_flag` is a LEFT JOIN so a
        // movement with no `adjust_subparts` row at all still counts (NULL
        // reads as not-flagged) - exactly `bom/qoh.ts`'s shape and its exact
        // `(fv_flag."valueBoolean" IS NULL OR fv_flag."valueBoolean" = false)`
        // predicate.
        const rows = await db
          .select({
            partId: sql<string>`fv_part."relatedEntityId"`,
            quantity: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
            valueMinor: sql<string>`COALESCE(SUM(fv_cost."valueNumber"), 0)`,
          })
          .from(schema.FieldValue)
          .innerJoin(
            sql`"FieldValue" fv_part`,
            sql`${schema.FieldValue.entityId} = fv_part."entityId"
              AND fv_part."fieldId" = ${partField.id}
              AND fv_part."relatedEntityId" IN (${idList})
              AND fv_part."organizationId" = ${organizationId}`
          )
          .innerJoin(
            sql`"FieldValue" fv_cost`,
            sql`${schema.FieldValue.entityId} = fv_cost."entityId"
              AND fv_cost."fieldId" = ${extendedCostField.id}
              AND fv_cost."organizationId" = ${organizationId}`
          )
          .leftJoin(
            sql`"FieldValue" fv_flag`,
            sql`${schema.FieldValue.entityId} = fv_flag."entityId"
              AND fv_flag."fieldId" = ${flagFieldId}
              AND fv_flag."organizationId" = ${organizationId}`
          )
          .where(
            and(
              eq(schema.FieldValue.fieldId, quantityField.id),
              eq(schema.FieldValue.organizationId, organizationId),
              sql`(fv_flag."valueBoolean" IS NULL OR fv_flag."valueBoolean" = false)`
            )
          )
          .groupBy(sql`fv_part."relatedEntityId"`)

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
 * What each fulfillment line has already been relieved at: `Σ extended_cost /
 * Σ quantity` over that line's own `sale`-typed movements (§3.5).
 *
 * 🛑 Scoped to `stock_movement_type = 'sale'` as an INNER JOIN, matching
 * `field-hooks/post/fulfillment-line-rollups.ts`'s `readTotalsByLine`
 * predicate exactly (same `fv_line` join shape, same `fv_type` join scoping
 * to {@link StockMovementType.SALE}). `receiving/reverse-movement.ts` maps a
 * reversed `sale` to `return_in` - the same label brief 54's customer returns
 * will use - and a `return_in` row must never read as un-relief or a customer
 * return would silently re-relieve the same units on the next sync. Scoping
 * this at the SQL join, never as a post-filter, is what keeps this read and
 * the quantity roll-up from ever disagreeing about which rows count.
 *
 * ⚠️ A `sale` movement's `stock_movement_quantity` AND `stock_movement_extended_cost`
 * are both NEGATIVE (units and value leaving the shelf). Both outputs here
 * are POSITIVE, so both sums are negated - and each negation is guarded
 * against `-0` (a net-zero SUM negates to `-0` in JS, which is deep-unequal
 * to `0`), the exact bug `fulfillment-line-rollups.ts` documents and fixes
 * the same way.
 *
 * Batched: one query for the whole `fulfillmentLineIds` set (chunked only for
 * very large sets - see {@link MAX_IDS_PER_QUERY}). Empty input returns an
 * empty Map without touching the database. A line with no `sale` movements at
 * all is ABSENT from the Map, not a zero row - the caller decides what
 * absence means. A line whose sales net to exactly zero (fully un-relieved)
 * IS present, with `relievedQuantity: 0` and `unitCostMinor: null`.
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

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'stock_movement_fulfillment_line',
          'stock_movement_type',
          'stock_movement_quantity',
          'stock_movement_extended_cost',
        ] as const)

      const lineRelField = fields.stock_movement_fulfillment_line
      const typeField = fields.stock_movement_type
      const quantityField = fields.stock_movement_quantity
      const extendedCostField = fields.stock_movement_extended_cost

      if (!lineRelField || !typeField || !quantityField || !extendedCostField) {
        throw new UnprocessableEntityError(
          'This organization has no stock_movement fulfillment-line/type/quantity/extended-cost fields provisioned'
        )
      }

      for (const idChunk of chunk(uniqueIds, MAX_IDS_PER_QUERY)) {
        const idList = sql.join(
          idChunk.map((id) => sql`${id}`),
          sql`, `
        )

        // Base row = the movement's `quantity` FieldValue. `fv_line` restricts
        // to this chunk's fulfillment lines; `fv_type` is the INNER JOIN that
        // excludes every non-`sale` row (a `return_in` reversal included) at
        // the join itself; `fv_cost` is the same movement's `extended_cost`,
        // joined so both sums come from one grouped statement, mirroring
        // `fulfillment-line-rollups.ts`'s `readTotalsByLine` plus the added
        // cost sum.
        const rows = await db
          .select({
            lineId: sql<string>`fv_line."relatedEntityId"`,
            quantity: sql<string>`COALESCE(SUM(${schema.FieldValue.valueNumber}), 0)`,
            valueMinor: sql<string>`COALESCE(SUM(fv_cost."valueNumber"), 0)`,
          })
          .from(schema.FieldValue)
          .innerJoin(
            sql`"FieldValue" fv_line`,
            sql`${schema.FieldValue.entityId} = fv_line."entityId"
              AND fv_line."fieldId" = ${lineRelField.id}
              AND fv_line."relatedEntityId" IN (${idList})
              AND fv_line."organizationId" = ${organizationId}`
          )
          .innerJoin(
            sql`"FieldValue" fv_type`,
            sql`${schema.FieldValue.entityId} = fv_type."entityId"
              AND fv_type."fieldId" = ${typeField.id}
              AND fv_type."organizationId" = ${organizationId}
              AND fv_type."optionId" = ${StockMovementType.SALE}`
          )
          .innerJoin(
            sql`"FieldValue" fv_cost`,
            sql`${schema.FieldValue.entityId} = fv_cost."entityId"
              AND fv_cost."fieldId" = ${extendedCostField.id}
              AND fv_cost."organizationId" = ${organizationId}`
          )
          .where(
            and(
              eq(schema.FieldValue.fieldId, quantityField.id),
              eq(schema.FieldValue.organizationId, organizationId)
            )
          )
          .groupBy(sql`fv_line."relatedEntityId"`)

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

// packages/lib/src/relief/relieve.ts

/**
 * `relieveFulfillmentLines` - the ~40-line seventh caller of
 * `writeStockMovements` (plans/money/tasks/50-batch-inventory-relief.md §1).
 *
 * One `sale` movement per `fulfillment_line`, for `quantity -
 * quantity_relieved`, written automatically at the dispatch's own date. §1.5
 * gives the contract verbatim; this file is that contract, plus the reads it
 * needs that no other module owns yet.
 *
 * ## The two doors, one caller shape (§1.4)
 *
 * Both `money/orders/fulfill.ts` (after `isExpectedPostOutcome` passes, next
 * to the posting stamp - NOT inside the fulfillment transaction) and
 * `events/handlers/passes/fulfillment-log-pass.ts` (over the fulfillments a
 * sync wrote) build a `FulfillmentLineToRelieve[]` from data they already
 * have and call this function. Neither is gated on `isAccountingEnabled` or
 * `accounting.fulfillmentPosting` - on-hand is an inventory fact, not an
 * accounting one (§1.4).
 *
 * ## What this file does NOT own
 *
 * `cost-reads.ts` (§3's ledger-average and relieved-average reads) is a
 * separate agent's surface, built concurrently against the signatures below.
 * If that module is not there yet, the import still names it - see
 * `relief/index.ts`'s header for how the two halves land independently.
 *
 * ## Judgment calls this file makes that the brief leaves open
 *
 * 1. **`costBasis: 'standard'` on every relief row.** §1.5 does not name a
 *    basis, and the enum has only `standard` | `actual` - neither is
 *    literally true of a ledger AVERAGE (§3.3: "not a new costing method...
 *    the arithmetic answer to what the account holds"). `standard` is the
 *    closer of the two: like `adjustStock` and `completeBuild`, this is an
 *    internally-computed valuation, never a vendor's invoice price.
 * 2. **A cancelled fulfillment's lines are not relieved.** `isLiveFulfillment`
 *    exists in `money/fulfillments/client.ts` precisely because its own
 *    header calls this "an open decision for task 50" (§9 item 3 of this
 *    brief agrees it is "mechanical and probably right"). Filtering happens
 *    in the CALLERS (they already hold `Fulfillment.status`), not here - this
 *    function only ever sees lines a caller decided are live.
 * 3. **A line whose cost cannot be priced at all** (no ledger average, no
 *    fallback standard cost, or no relieved average for a down-delta) is
 *    skipped and counted (`skippedNoCost`), never written at zero. "Never
 *    post a zero cost" is the same rule `complete-build.ts` enforces from the
 *    build side.
 * 4. **The unit cost is rounded to `RATE_DECIMALS`** via `roundMinorUnits`
 *    before it is handed to `writeStockMovements`, defensively - `V / Q` and
 *    `Σcost / Σqty` are both arbitrary-precision divisions and this module
 *    does not assume `cost-reads.ts` already rounded its output.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { batchRecalculateQoH } from '../bom/qoh'
import { readStandardCost } from '../builds'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { recalculateFulfillmentLineQuantityRelievedBatch } from '../field-hooks/post/fulfillment-line-rollups'
import { resolveInventoryRoleForPartKind, roundMinorUnits } from '../receiving/client'
import { StockMovementCostBasis, StockMovementType } from '../resources/registry/enum-values'
import {
  type StockMovementInput,
  type StockMovementsCtx,
  writeStockMovements,
} from '../stock-movements'
import { readFulfillmentLineRelievedAverages, readPartLedgerAverages } from './cost-reads'
import { guard } from './guard'
import { announceQuietReliefWrites, reliefWriteSession } from './write-lane'

const logger = createScopedLogger('relief')

/** One `fulfillment_line` a caller wants relieved (or un-relieved) against. */
export interface FulfillmentLineToRelieve {
  /** The `fulfillment_line` EntityInstance id. */
  fulfillmentLineId: string
  /** The `line_item` EntityInstance id this line shipped against. */
  lineItemId: string
  /** `fulfillment_line_quantity` - units shipped in this dispatch. */
  quantity: number
  /**
   * `fulfillment_line_quantity_relieved` as currently stored. `null` means
   * relief has never run for this line - not the same as `0`, but the delta
   * arithmetic (`quantity - (quantityRelieved ?? 0)`) treats them the same,
   * which is correct: a line relieved to exactly zero and a line never
   * touched both owe their full `quantity`.
   */
  quantityRelieved: number | null
  /** `fulfillment_shipped_at` - the dispatch's OWN date, never `createdAt`. */
  occurredAt: Date
}

export interface RelieveFulfillmentLinesInput {
  organizationId: string
  userId: string
  lines: FulfillmentLineToRelieve[]
}

/**
 * What one relief run did, for the caller's own logging/telemetry. Every
 * count is per-RUN, not per-movement (§4.2: "a structured warning per part,
 * once per run, not once per movement").
 */
export interface RelieveFulfillmentLinesResult {
  /** The `stock_movement` records this run created. */
  movementIds: string[]
  /** Distinct parts whose QoH this run recalculated. */
  affectedPartIds: string[]
  /** §1.6 - lines with no `line_item_part`. Never guessed at, always counted. */
  skippedNoPart: number
  /** §1.5 - a delta of zero writes no row. */
  skippedZeroDelta: number
  /** A line with a real delta that could not be priced at all. Never posted at zero. */
  skippedNoCost: number
  /** Parts §3.6's fallback priced at `part_standard_cost` because QoH was <= 0. */
  fallbackStandardCostPartIds: string[]
  /** §4.2 - parts this run would leave (or already left) at negative QoH. Warn, never refuse. */
  negativeQoHPartIds: string[]
}

/** One line resolved to a part and a non-zero signed delta, ready to price. */
interface ResolvedReliefLine {
  fulfillmentLineId: string
  partInstanceId: string
  /** SIGNED, matching `StockMovementInput.quantity`'s convention. */
  delta: number
  occurredAt: Date
}

/**
 * `line_item_part` for a set of line items - `EntityInstance.id -> part
 * EntityInstance.id`, entries with no part simply absent (§1.6: skip, never
 * guess).
 */
async function readLineItemParts(
  db: Database,
  organizationId: string,
  lineItemInstanceIds: string[]
): Promise<Map<string, string>> {
  const parts = new Map<string, string>()
  if (lineItemInstanceIds.length === 0) return parts

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_part'] as const)
  const partField = fields.line_item_part
  if (!partField) return parts

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...new Set(lineItemInstanceIds)]),
        eq(schema.FieldValue.fieldId, partField.id)
      )
    )

  for (const row of rows) {
    if (row.relatedEntityId) parts.set(row.entityId, row.relatedEntityId)
  }
  return parts
}

/**
 * `part_kind` for a set of parts. A part with no row (unclassified) is absent
 * from the map, and {@link resolveInventoryRoleForPartKind} already reads
 * that absence as "raw materials" - the same convention `builds/build-queries
 * .ts`'s `readPartKinds` uses. Kept local rather than imported from `builds/`
 * because that module is not this brief's to touch and does not export it
 * through its public barrel.
 */
async function readPartKindsLocal(
  db: Database,
  organizationId: string,
  partInstanceIds: string[]
): Promise<Map<string, string>> {
  const kinds = new Map<string, string>()
  if (partInstanceIds.length === 0) return kinds

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_kind'] as const)
  const kindField = fields.part_kind
  if (!kindField) return kinds

  const rows = await db
    .select({ entityId: schema.FieldValue.entityId, optionId: schema.FieldValue.optionId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...new Set(partInstanceIds)]),
        eq(schema.FieldValue.fieldId, kindField.id)
      )
    )

  for (const row of rows) {
    if (row.optionId) kinds.set(row.entityId, row.optionId)
  }
  return kinds
}

/**
 * Relieve inventory for a set of fulfillment lines: one `sale` movement per
 * line with a non-zero delta, written through the quiet lane, with both
 * post-commit recalculations discharged before this returns.
 *
 * Never refuses on a pricing or QoH problem (§3.6, §4.2) - a line that
 * genuinely cannot be priced is skipped and counted, and a part that goes
 * negative is warned about, never blocked. The only way this returns `Err` is
 * an infrastructure failure (a def lookup, the write itself, or a read
 * throwing) - never a business condition this module already has a documented
 * answer for.
 */
export async function relieveFulfillmentLines(
  db: Database,
  input: RelieveFulfillmentLinesInput
): Promise<Result<RelieveFulfillmentLinesResult, Error>> {
  const { organizationId, userId, lines } = input

  return guard(
    async () => {
      let skippedNoPart = 0
      let skippedZeroDelta = 0

      if (lines.length === 0) {
        return {
          movementIds: [],
          affectedPartIds: [],
          skippedNoPart,
          skippedZeroDelta,
          skippedNoCost: 0,
          fallbackStandardCostPartIds: [],
          negativeQoHPartIds: [],
        }
      }

      // §1.6: no part means no account, no cost, no on-hand number. Skip,
      // never guess. Resolved BEFORE the delta filter so a no-part line is
      // counted separately from a zero-delta one - they are different facts
      // (one is unmappable COGS forever, the other is nothing new to relieve).
      const lineItemIds = lines.map((line) => line.lineItemId)
      const partByLineItem = await readLineItemParts(db, organizationId, lineItemIds)

      const resolved: ResolvedReliefLine[] = []
      for (const line of lines) {
        const partInstanceId = partByLineItem.get(line.lineItemId)
        if (!partInstanceId) {
          skippedNoPart++
          logger.warn('Relief skipped a line with no line_item_part - COGS will never appear', {
            organizationId,
            fulfillmentLineId: line.fulfillmentLineId,
            lineItemId: line.lineItemId,
          })
          continue
        }
        // §1.5: `-(quantity - quantity_relieved)` is the MOVEMENT's signed
        // quantity (units leaving the shelf, negative). `delta` here is kept
        // as the un-negated `quantity - quantityRelieved` until the input is
        // built, where it becomes the movement's own negated sign - see
        // `buildMovementInput` below.
        const delta = line.quantity - (line.quantityRelieved ?? 0)
        if (delta === 0) {
          skippedZeroDelta++
          continue
        }
        resolved.push({
          fulfillmentLineId: line.fulfillmentLineId,
          partInstanceId,
          delta,
          occurredAt: line.occurredAt,
        })
      }

      if (resolved.length === 0) {
        return {
          movementIds: [],
          affectedPartIds: [],
          skippedNoPart,
          skippedZeroDelta,
          skippedNoCost: 0,
          fallbackStandardCostPartIds: [],
          negativeQoHPartIds: [],
        }
      }

      const partIds = [...new Set(resolved.map((line) => line.partInstanceId))]

      // §3.4: the ledger average's numerator and denominator come from ONE
      // statement, `adjust_subparts IS NOT TRUE` on both - `cost-reads.ts`'s
      // contract. Read for every distinct part in this run, not only the
      // ones pricing a positive delta: the `quantity` half also feeds the
      // §4.2 negative-QoH prediction below, for EVERY part touched.
      const ledgerAveragesResult = await readPartLedgerAverages(db, {
        organizationId,
        partInstanceIds: partIds,
      })
      if (ledgerAveragesResult.isErr()) throw ledgerAveragesResult.error
      const ledgerAverages = ledgerAveragesResult.value

      const negativeDeltaLineIds = resolved
        .filter((line) => line.delta < 0)
        .map((line) => line.fulfillmentLineId)
      const relievedAveragesResult = await readFulfillmentLineRelievedAverages(db, {
        organizationId,
        fulfillmentLineIds: negativeDeltaLineIds,
      })
      if (relievedAveragesResult.isErr()) throw relievedAveragesResult.error
      const relievedAverages = relievedAveragesResult.value

      // §3.6: QoH of zero or negative has no average - `unitCostMinor: null`.
      // Fall back to `part_standard_cost`, warning and naming the part, and
      // only read it for the parts that actually need it.
      const partsNeedingFallback = [
        ...new Set(
          resolved
            .filter((line) => line.delta > 0)
            .filter((line) => ledgerAverages.get(line.partInstanceId)?.unitCostMinor == null)
            .map((line) => line.partInstanceId)
        ),
      ]
      const standardCosts: Map<string, number> =
        partsNeedingFallback.length > 0
          ? await guardedReadStandardCost(db, organizationId, partsNeedingFallback)
          : new Map()

      const partKinds = await readPartKindsLocal(db, organizationId, partIds)

      const inputs: StockMovementInput[] = []
      const relievedLineIds: string[] = []
      let skippedNoCost = 0
      const fallbackStandardCostPartIds = new Set<string>()
      const deltaWrittenByPart = new Map<string, number>()

      for (const line of resolved) {
        let unitCostMinor: number | null
        if (line.delta > 0) {
          unitCostMinor = ledgerAverages.get(line.partInstanceId)?.unitCostMinor ?? null
          if (unitCostMinor == null) {
            const standard = standardCosts.get(line.partInstanceId)
            if (standard != null) {
              unitCostMinor = standard
              fallbackStandardCostPartIds.add(line.partInstanceId)
            }
          }
        } else {
          // §3.5: priced at what THIS line was already relieved at, never at
          // today's average - the down-delta un-relieves a specific prior
          // valuation, not a fresh purchase.
          unitCostMinor = relievedAverages.get(line.fulfillmentLineId)?.unitCostMinor ?? null
        }

        if (unitCostMinor == null) {
          skippedNoCost++
          logger.error('Relief skipped a line - no cost could be determined', {
            organizationId,
            fulfillmentLineId: line.fulfillmentLineId,
            partInstanceId: line.partInstanceId,
            delta: line.delta,
          })
          continue
        }

        const glAccount = resolveInventoryRoleForPartKind(
          partKinds.get(line.partInstanceId) ?? null
        )

        inputs.push({
          partInstanceId: line.partInstanceId,
          type: StockMovementType.SALE,
          // §1.5: `-(quantity - quantity_relieved)`. `line.delta` is the
          // un-negated `quantity - quantityRelieved`; the MOVEMENT's signed
          // quantity is its negation, regardless of `delta`'s own sign - a
          // positive delta (more to relieve) writes a NEGATIVE movement
          // (units leaving the shelf), and a negative delta (over-relieved,
          // correcting) writes a POSITIVE movement, per §1.5's own text: "The
          // down-delta is a `sale` row at a positive quantity."
          quantity: -line.delta,
          unitCost: roundMinorUnits(unitCostMinor),
          costBasis: StockMovementCostBasis.STANDARD,
          glAccount,
          occurredAt: line.occurredAt,
          // adjustSubparts omitted - defaults to false (§1.5, always).
          links: { fulfillmentLineId: line.fulfillmentLineId },
        })
        relievedLineIds.push(line.fulfillmentLineId)

        deltaWrittenByPart.set(
          line.partInstanceId,
          (deltaWrittenByPart.get(line.partInstanceId) ?? 0) + -line.delta
        )
      }

      // §4.2: warn, never refuse. Predicted from the SAME `quantity` §3.4
      // read as the pricing average (never the cached, one-recalc-behind
      // `part_quantity_on_hand`), plus what THIS run is about to write.
      const negativeQoHPartIds = new Set<string>()
      for (const [partId, deltaWritten] of deltaWrittenByPart) {
        const existing = ledgerAverages.get(partId)?.quantity ?? 0
        if (existing + deltaWritten < 0) negativeQoHPartIds.add(partId)
      }
      if (negativeQoHPartIds.size > 0) {
        logger.warn('Relief will leave quantity on hand negative for some parts', {
          organizationId,
          partInstanceIds: [...negativeQoHPartIds],
        })
      }

      if (inputs.length === 0) {
        return {
          movementIds: [],
          affectedPartIds: [],
          skippedNoPart,
          skippedZeroDelta,
          skippedNoCost,
          fallbackStandardCostPartIds: [...fallbackStandardCostPartIds],
          negativeQoHPartIds: [...negativeQoHPartIds],
        }
      }

      const [movementDefId, partDefId] = await Promise.all([
        requireCachedEntityDefId(organizationId, 'stock_movement'),
        requireCachedEntityDefId(organizationId, 'part'),
      ])

      // §1.7: quietSession(reason) -> N movements in one tx -> (AFTER COMMIT)
      // batchRecalculateQoH. This function owns the transaction boundary -
      // `writeStockMovements` never opens one of its own (its own header) -
      // exactly as `complete-build.ts`'s `db.transaction` wraps `writeCompletion`.
      const session = reliefWriteSession()
      let movementIds: string[] = []
      let affectedPartIds: string[] = []
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const ctx: StockMovementsCtx = {
          db: txDb,
          organizationId,
          userId,
          movementDefId,
          partDefId,
          lane: { kind: 'quiet', session },
        }
        const written = await writeStockMovements(ctx, inputs)
        if (written.isErr()) throw written.error
        movementIds = written.value.records.map((record) => record.movementId)
        affectedPartIds = written.value.affectedPartIds
      })

      // ── Post-commit, both obligations (write-lane.ts's header) ──────────
      await batchRecalculateQoH(organizationId, affectedPartIds)
      await recalculateFulfillmentLineQuantityRelievedBatch(organizationId, relievedLineIds)
      announceQuietReliefWrites(organizationId, movementDefId, movementIds)

      logger.info('Relieved inventory for fulfillment lines', {
        organizationId,
        written: movementIds.length,
        skippedNoPart,
        skippedZeroDelta,
        skippedNoCost,
        fallbackStandardCostPartIds: fallbackStandardCostPartIds.size,
        negativeQoHPartIds: negativeQoHPartIds.size,
      })

      return {
        movementIds,
        affectedPartIds,
        skippedNoPart,
        skippedZeroDelta,
        skippedNoCost,
        fallbackStandardCostPartIds: [...fallbackStandardCostPartIds],
        negativeQoHPartIds: [...negativeQoHPartIds],
      }
    },
    'Failed to relieve inventory for fulfillment lines',
    { organizationId, lineCount: lines.length }
  )
}

/**
 * {@link readStandardCost}, narrowed to a plain `Map` for this module's own
 * use - a `readStandardCost` failure here degrades to "no fallback available"
 * (every affected line then falls into `skippedNoCost`) rather than failing
 * the whole run, because §3.6 says the writer "never refuses" on a pricing
 * problem.
 */
async function guardedReadStandardCost(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, number>> {
  const result = await readStandardCost(db, organizationId, partIds)
  if (result.isErr()) {
    logger.error('Relief could not read standard cost fallback - affected lines will be skipped', {
      organizationId,
      partIds,
      error: result.error.message,
    })
    return new Map()
  }
  const byPart = new Map<string, number>()
  for (const [partId, standard] of result.value) {
    byPart.set(partId, standard.standardCost)
  }
  return byPart
}

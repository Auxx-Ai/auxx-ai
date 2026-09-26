// packages/lib/src/inventory/relief/relieve.ts

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
 * Both `money/orders/fulfill.ts` (after `didLedgerAccept` passes, next
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
 * 1. **`costBasis: 'standard'` on every relief row**, and since 73 §6.2 rule 3
 *    it is true rather than merely the closer of two: a relief is priced at the
 *    finished good's frozen `part_standard_cost` and split across
 *    `cogs_product_cost` / `cogs_direct_labor` / `applied_overhead` by that
 *    standard's own composition. The ledger average is a report now.
 * 2. **A cancelled fulfillment's lines are not relieved.** `isLiveFulfillment`
 *    exists in `money/fulfillments/client.ts` precisely because its own
 *    header calls this "an open decision for task 50" (§9 item 3 of this
 *    brief agrees it is "mechanical and probably right"). Filtering happens
 *    in the CALLERS (they already hold `Fulfillment.status`), not here - this
 *    function only ever sees lines a caller decided are live.
 * 3. **A line whose cost cannot be priced yet** (no standard on an up-delta, no
 *    relieved average on a down-delta) is still WRITTEN, as a `pending` row
 *    with no cost (111 Q18): the quantity never waits on the cost. It is
 *    counted (`skippedNoCost`), never posted here, and its dispatch is parked
 *    at stage `price` until the pricer fills the row and posts it. "Never post
 *    a zero cost" is the same rule `complete-build.ts` enforces from the build
 *    side; a pending row is not a zero, it is an absence with a marker.
 * 4. **The unit cost is rounded to `RATE_DECIMALS`** via `roundMinorUnits`
 *    before it is handed to `writeStockMovements`, defensively - `V / Q` and
 *    `Σcost / Σqty` are both arbitrary-precision divisions and this module
 *    does not assume `cost-reads.ts` already rounded its output.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { roundMinorUnits } from '@auxx/utils/currency'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type {
  InventoryMovementLine,
  ReliefCogsSplit,
} from '../../accounting/ledger/builders/inventory-movement'
import { withAccountingCommitLock } from '../../accounting/ledger/post/accounting-commit-lock'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import { saleDocumentParents } from '../../accounting/ledger/post/post-inventory-document'
import {
  exportInventoryMovement,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import type { PostResult } from '../../accounting/ledger/types'
import { deleteWorkItemsAtStage, upsertWorkItem } from '../../accounting/work-items/write'
import { requireCachedEntityDefId } from '../../cache'
import { ConflictError } from '../../errors'
import {
  readRelievedQuantities,
  recalculateFulfillmentLineQuantityRelievedBatch,
} from '../../field-hooks/post/fulfillment-line-rollups'
import { StockMovementCostBasis, StockMovementType } from '../../resources/registry/enum-values'
import { readSystemRecords, systemFieldMap } from '../../resources/system-records'
import { readStandardCost } from '../costing'
import { isServicePartKind } from '../costing/client'
import { readFulfillmentLineRelievedAverages, readPartLedgerAverages } from '../costing/cost-reads'
import { batchRecalculateQoH } from '../costing/qoh'
import type { PartStandardCost } from '../costing/types'
import type { WrittenStockMovement } from '../movements'
import { type StockMovementInput, type StockMovementsCtx, writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { type ReliefSplitLine, sumReliefCogsSplit } from './cogs-split'
import { guard } from './guard'
import { announceQuietReliefWrites, reliefWriteSession } from './write-lane'

const logger = createScopedLogger('relief')

/** One `fulfillment_line` a caller wants relieved (or un-relieved) against. */
export interface FulfillmentLineToRelieve {
  /** The `fulfillment_line` EntityInstance id. */
  fulfillmentLineId: string
  /** The `fulfillment` this line belongs to; each run's entry links it as a parent. */
  fulfillmentId: string
  /** The `order` the fulfillment shipped against, the entry's other parent link. */
  orderId: string
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
  /** Lines written as `pending` rows with no cost (111 Q18); the name predates the pending state. */
  skippedNoCost: number
  /** A line whose part is a `service`: no stock, so no movement, no COGS and no park (107-D10). */
  skippedService: number
  /** §4.2 - parts this run would leave (or already left) at negative QoH. Warn, never refuse. */
  negativeQoHPartIds: string[]
  /** One outcome per fulfillment this run posted an entry for; always this run's own entry. */
  posts: PostResult[]
}

/** One line resolved to a part and a non-zero signed delta, ready to price. */
interface ResolvedReliefLine {
  fulfillmentLineId: string
  fulfillmentId: string
  orderId: string
  partInstanceId: string
  /** SIGNED, matching `StockMovementInput.quantity`'s convention. */
  delta: number
  /** The relieved total `delta` was computed from, re-checked under the lock. */
  quantityRelieved: number
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

  const fields = await systemFieldMap(db, organizationId, ['line_item_part'] as const)
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

  const fields = await systemFieldMap(db, organizationId, ['part_kind'] as const)
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
  const tracker: ReliefTracker = { unpricedParts: new Map(), standardsUnread: false }
  const result = await relieveLines(db, input, tracker)
  // An unread standard is an outage, not a missing standard: leave the rows as they are.
  if (result.isOk() && !tracker.standardsUnread) {
    try {
      await syncReliefWorkItems(db, input.organizationId, input.lines, tracker.unpricedParts)
    } catch (error) {
      // The movements committed; a missed park is re-derived by the next relief of the dispatch.
      logger.error('Relief could not record its work items', {
        organizationId: input.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** What the run learned that its result does not carry: which dispatches lack a standard. */
interface ReliefTracker {
  /** `fulfillmentId -> partIds` with no standard, in line order. */
  unpricedParts: Map<string, string[]>
  standardsUnread: boolean
}

async function relieveLines(
  db: Database,
  input: RelieveFulfillmentLinesInput,
  tracker: ReliefTracker
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
          skippedService: 0,
          negativeQoHPartIds: [],
          posts: [],
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
          fulfillmentId: line.fulfillmentId,
          orderId: line.orderId,
          partInstanceId,
          delta,
          quantityRelieved: line.quantityRelieved ?? 0,
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
          skippedService: 0,
          negativeQoHPartIds: [],
          posts: [],
        }
      }

      const partIds = [...new Set(resolved.map((line) => line.partInstanceId))]

      // 73 §6.2 rule 3: this read no longer PRICES anything. Its `quantity`
      // half is still the live on-hand figure the §4.2 negative-QoH prediction
      // is made from - never the cached, one-recalc-behind
      // `part_quantity_on_hand` - and `unitCostMinor` stays a report.
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

      // 73 §6.2 rule 3: relief is at the finished good's frozen STANDARD, with
      // its material / labour / overhead composition, so the standard is the
      // only price and there is no fallback behind it. A part with none is
      // skipped, for the same reason `completeBuild` refuses one: every other
      // writer values at standard, and relieving at an average would break the
      // invariant the close now checks (rule 4).
      const standardCosts = await guardedReadStandardCost(db, organizationId, partIds)
      if (!standardCosts) tracker.standardsUnread = true

      const partKinds = await readPartKindsLocal(db, organizationId, partIds)

      const inputs: StockMovementInput[] = []
      // The line behind each input, in the same order, so the written records
      // can be regrouped by their dispatch without re-deriving which were skipped.
      const inputLines: ResolvedReliefLine[] = []
      /** Parallel to `inputLines`: the standard each line's COGS splits by. */
      const inputStandards: (PartStandardCost | null)[] = []
      const relievedLineIds: string[] = []
      let skippedNoCost = 0
      let skippedService = 0
      const deltaWrittenByPart = new Map<string, number>()

      for (const line of resolved) {
        // Before pricing: a service has no standard by design and must never park.
        if (isServicePartKind(partKinds.get(line.partInstanceId))) {
          skippedService++
          continue
        }
        const standard = standardCosts?.get(line.partInstanceId) ?? null
        // §3.5: a down-delta is priced at what THIS line was already relieved
        // at, never at today's average - it un-relieves a specific prior
        // valuation, not a fresh purchase.
        const unitCostMinor =
          line.delta > 0
            ? (standard?.standardCost ?? null)
            : (relievedAverages.get(line.fulfillmentLineId)?.unitCostMinor ?? null)

        // 111 Q18: no price yet is a `pending` row, not a skipped line. A
        // down-delta of a line relieved while pending has no relieved average
        // and goes pending too; the pricer fills both when the standard lands.
        const pending = unitCostMinor == null
        if (pending) {
          skippedNoCost++
          const parts = tracker.unpricedParts.get(line.fulfillmentId) ?? []
          if (!parts.includes(line.partInstanceId)) parts.push(line.partInstanceId)
          tracker.unpricedParts.set(line.fulfillmentId, parts)
          logger.warn('Relief wrote a pending row - no cost could be determined yet', {
            organizationId,
            fulfillmentLineId: line.fulfillmentLineId,
            partInstanceId: line.partInstanceId,
            delta: line.delta,
          })
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
          unitCost: unitCostMinor == null ? null : roundMinorUnits(unitCostMinor),
          costBasis: pending ? StockMovementCostBasis.PENDING : StockMovementCostBasis.STANDARD,
          glAccount,
          occurredAt: line.occurredAt,
          // adjustSubparts omitted - defaults to false (§1.5, always).
          links: { fulfillmentLineId: line.fulfillmentLineId },
        })
        inputLines.push(line)
        // The composition this line's COGS is split by, or `null` for an
        // un-relief - it is priced at what the line was relieved at, which is
        // not today's standard and carries no composition of its own.
        inputStandards.push(line.delta > 0 && !pending ? standard : null)
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
          skippedService,
          negativeQoHPartIds: [...negativeQoHPartIds],
          posts: [],
        }
      }

      const [movementDefId, partDefId, lineDefId] = await Promise.all([
        requireCachedEntityDefId(organizationId, 'stock_movement'),
        requireCachedEntityDefId(organizationId, 'part'),
        requireCachedEntityDefId(organizationId, 'fulfillment_line'),
      ])

      // §1.7: quietSession(reason) -> N movements in one tx -> (AFTER COMMIT)
      // batchRecalculateQoH. This function owns the transaction boundary -
      // `writeStockMovements` never opens one of its own (its own header) -
      // exactly as `complete-build.ts`'s `db.transaction` wraps `writeCompletion`.
      // A run that throws here leaves nothing: the movements' ids are minted inside it.
      const session = reliefWriteSession()
      let movementIds: string[] = []
      let affectedPartIds: string[] = []
      let pending: Array<InTxPostResult | null> = []
      try {
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Database
          // Serialises relief with every other posting in the org, so the re-read below sees any
          // run that committed first and a second run cannot write the same units again.
          await withAccountingCommitLock(tx, organizationId)
          await assertReliefUnchanged(txDb, organizationId, inputLines)
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

          // One entry per fulfillment per RUN: a dispatch relieved twice (a standard priced
          // later) posts twice. The run's first movement is the subject, so each run claims its
          // own identity and doc number; the fulfillment is a parent beside the order.
          pending = await Promise.all(
            groupByFulfillment(inputLines, inputStandards, written.value.records).map((document) =>
              postInventoryMovementInTx(tx, {
                organizationId,
                kind: 'sale',
                cogsSplit: document.cogsSplit,
                subject: { sourceKind: 'stock_movement', sourceId: document.movements[0]!.id },
                parents: saleDocumentParents(document.fulfillmentId, document.orderId),
                occurredAt: document.occurredAt,
                movements: document.movements,
                actorUserId: userId,
              })
            )
          )
          // A fresh movement cannot already be claimed; if it is, these movements would
          // commit with someone else's entry standing in for their COGS.
          if (pending.some((post) => post?.status === 'already_posted')) {
            throw new ConflictError('A relief run found its entry already posted', {
              organizationId,
            })
          }
        })
      } catch (error) {
        // A stale roll-up is what makes the lock's re-read disagree; refresh it for the next run.
        if (error instanceof ReliefRaceError) {
          await recalculateFulfillmentLineQuantityRelievedBatch(organizationId, relievedLineIds)
        }
        throw error
      }

      const posts: PostResult[] = []
      for (const post of pending) {
        const exported = await exportInventoryMovement(db, post)
        if (exported) posts.push(exported)
      }

      // ── Post-commit, both obligations (write-lane.ts's header) ──────────
      await batchRecalculateQoH(organizationId, affectedPartIds)
      await recalculateFulfillmentLineQuantityRelievedBatch(organizationId, relievedLineIds)
      announceQuietReliefWrites(organizationId, movementDefId, movementIds)
      // The covered lane sends no inverse frames: the parts' and lines' movement lists.
      announceQuietReliefWrites(organizationId, partDefId, affectedPartIds)
      announceQuietReliefWrites(organizationId, lineDefId, [...new Set(relievedLineIds)])

      logger.info('Relieved inventory for fulfillment lines', {
        organizationId,
        written: movementIds.length,
        skippedNoPart,
        skippedZeroDelta,
        skippedNoCost,
        skippedService,
        negativeQoHPartIds: negativeQoHPartIds.size,
      })

      return {
        movementIds,
        affectedPartIds,
        skippedNoPart,
        skippedZeroDelta,
        skippedNoCost,
        skippedService,
        negativeQoHPartIds: [...negativeQoHPartIds],
        posts,
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
): Promise<Map<string, PartStandardCost> | null> {
  const result = await readStandardCost(db, organizationId, partIds)
  if (result.isErr()) {
    logger.error('Relief could not read standard costs - affected lines will be skipped', {
      organizationId,
      partIds,
      error: result.error.message,
    })
    return null
  }
  return result.value
}

/** The lines' relieved totals moved since this run read them (a race or a stale roll-up). */
class ReliefRaceError extends ConflictError {}

/**
 * Refuse a run whose deltas no longer hold: every line's `sale` movements must still sum to the
 * relieved total its delta was computed from. Called under the commit lock, on the transaction.
 */
async function assertReliefUnchanged(
  tx: Database,
  organizationId: string,
  lines: readonly ResolvedReliefLine[]
): Promise<void> {
  const relieved = await readRelievedQuantities(
    tx,
    organizationId,
    lines.map((line) => line.fulfillmentLineId)
  )
  const moved = lines.filter(
    (line) => (relieved.get(line.fulfillmentLineId) ?? 0) !== line.quantityRelieved
  )
  if (moved.length === 0) return
  throw new ReliefRaceError(
    'These shipment lines were relieved since they were read; nothing was written, retry',
    { organizationId, fulfillmentLineIds: moved.map((line) => line.fulfillmentLineId) }
  )
}

/** One fulfillment's movements, as the entry builder reads them. */
interface ReliefDocument {
  fulfillmentId: string
  orderId: string
  occurredAt: Date
  movements: InventoryMovementLine[]
  /** 73 §6.2 rule 3. Summed across the dispatch's lines; `cogs_product_cost` takes the rest. */
  cogsSplit: ReliefCogsSplit
  /** The rows behind `cogsSplit`, kept until the group is complete. */
  splitLines: ReliefSplitLine[]
}

/**
 * The written rows, regrouped by the dispatch that caused them.
 *
 * `records` comes back in `inputs`' order, and `inputLines` is kept in that same
 * order, so the two zip by index. A row with no frozen account, no cost yet (a
 * `pending` row) or a zero cost is dropped: the builder throws on a null and
 * refuses a zero line, and a pending row is posted by the pricer, not here.
 */
function groupByFulfillment(
  inputLines: readonly ResolvedReliefLine[],
  inputStandards: readonly (PartStandardCost | null)[],
  records: readonly WrittenStockMovement[]
): ReliefDocument[] {
  const documents = new Map<string, ReliefDocument>()
  for (const [index, line] of inputLines.entries()) {
    const record = records[index]
    if (!record) continue
    if (!record.glAccount || record.extendedCost == null || record.extendedCost === 0) continue
    const document = documents.get(line.fulfillmentId) ?? {
      fulfillmentId: line.fulfillmentId,
      orderId: line.orderId,
      occurredAt: line.occurredAt,
      movements: [],
      cogsSplit: { laborMinor: 0, overheadMinor: 0 },
      splitLines: [],
    }
    document.movements.push({
      id: record.movementId,
      extendedCostMinor: record.extendedCost,
      glAccountRole: record.glAccount,
    })
    document.splitLines.push({
      extendedCost: record.extendedCost,
      quantity: record.quantity,
      standard: inputStandards[index] ?? null,
    })
    documents.set(line.fulfillmentId, document)
  }
  return [...documents.values()]
    .filter((document) => document.movements.length > 0)
    .map((document) => ({ ...document, cogsSplit: sumReliefCogsSplit(document.splitLines) }))
}

/**
 * One `price` work item per offered dispatch that still has a `pending` row
 * (plans/accounting/tasks/100 §1.3, 111 Q21); every other offered dispatch is
 * cleared. Runs after commit.
 *
 * Read from the ledger, not from this run alone: a re-run whose lines are all
 * at delta zero writes nothing, and must not clear a dispatch whose rows from
 * an earlier run are still waiting on a price. The pricer clears the item once
 * it has filled them.
 */
export async function syncReliefWorkItems(
  db: Database,
  organizationId: string,
  lines: readonly Pick<FulfillmentLineToRelieve, 'fulfillmentLineId' | 'fulfillmentId'>[],
  unpricedParts: ReadonlyMap<string, string[]>
): Promise<void> {
  const offered = [...new Set(lines.map((line) => line.fulfillmentId))]
  const pendingByFulfillment = await readPendingMovements(db, organizationId, lines)
  await deleteWorkItemsAtStage(db, organizationId, {
    sourceKind: 'fulfillment',
    sourceIds: offered.filter((id) => !pendingByFulfillment.has(id)),
    stage: 'price',
  })
  if (pendingByFulfillment.size === 0) return

  const partNames = await readPartNames(db, organizationId, [
    ...new Set([...pendingByFulfillment.values()].flatMap((pending) => pending.partIds)),
  ])
  for (const [fulfillmentId, pending] of pendingByFulfillment) {
    // This run's line order first, so the group key is the part a person saw fail.
    const partIds = [...new Set([...(unpricedParts.get(fulfillmentId) ?? []), ...pending.partIds])]
    const partId = partIds[0]!
    await upsertWorkItem(db, organizationId, {
      sourceKind: 'fulfillment',
      sourceId: fulfillmentId,
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      // The group key: one Blocked row per part, the part a person has to price.
      externalRef: partId,
      detail: {
        partIds,
        pendingMovementIds: pending.movementIds,
        ...(partNames.get(partId) ? { partName: partNames.get(partId) } : {}),
      },
    })
  }
}

/** Every `pending` movement on the offered lines, grouped by dispatch, in ledger order. */
async function readPendingMovements(
  db: Database,
  organizationId: string,
  lines: readonly Pick<FulfillmentLineToRelieve, 'fulfillmentLineId' | 'fulfillmentId'>[]
): Promise<Map<string, { movementIds: string[]; partIds: string[] }>> {
  const result = new Map<string, { movementIds: string[]; partIds: string[] }>()
  if (lines.length === 0) return result
  const fulfillmentByLine = new Map(
    lines.map((line) => [line.fulfillmentLineId, line.fulfillmentId])
  )
  const defId = await requireCachedEntityDefId(organizationId, 'stock_movement')
  const fields = await systemFieldMap(db, organizationId, [
    'stock_movement_fulfillment_line',
    'stock_movement_cost_basis',
    'stock_movement_part',
  ] as const)
  if (!fields.stock_movement_fulfillment_line || !fields.stock_movement_cost_basis) return result

  const records = await readSystemRecords(
    db,
    organizationId,
    { defId, fields },
    { by: { attribute: 'stock_movement_fulfillment_line', in: [...fulfillmentByLine.keys()] } }
  )
  for (const record of records) {
    if (record.option('stock_movement_cost_basis') !== StockMovementCostBasis.PENDING) continue
    const lineId = record.related('stock_movement_fulfillment_line')
    const fulfillmentId = lineId ? fulfillmentByLine.get(lineId) : undefined
    if (!fulfillmentId) continue
    const pending = result.get(fulfillmentId) ?? { movementIds: [], partIds: [] }
    pending.movementIds.push(record.id)
    const partId = record.related('stock_movement_part')
    if (partId && !pending.partIds.includes(partId)) pending.partIds.push(partId)
    result.set(fulfillmentId, pending)
  }
  return result
}

async function readPartNames(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, partIds)
      )
    )
  return new Map(rows.flatMap((row) => (row.displayName ? [[row.id, row.displayName]] : [])))
}

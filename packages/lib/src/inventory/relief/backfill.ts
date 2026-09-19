// packages/lib/src/inventory/relief/backfill.ts

/**
 * `backfillFulfillmentRelief` - relieve every fulfillment an organization
 * already holds, driven by the RECORDS rather than by a sync manifest.
 *
 * ## Why this door has to exist
 *
 * `relieveFulfillmentLines` had exactly two callers, and neither can reach a
 * fulfillment that is already on disk:
 *
 *  - `money/orders/fulfill.ts` fires on a NEW dispatch made in the app.
 *  - `events/handlers/passes/fulfillment-log-pass.ts` fires on a sync, over
 *    `manifest.touched` / `manifest.createdRecordIds` - the fulfillments that
 *    ARRIVED in that sync.
 *
 * 🛑 So a fulfillment whose `contentHash` is unchanged is counted `skipped` by
 * the connector, never lands in the manifest, and is never relieved - no
 * matter how many times the connector is re-synced. Anything that clears the
 * `sale` movements (a dev reset, a repair, a costing correction) therefore
 * leaves the shelf permanently wrong with no door back, because the only two
 * doors are both keyed on arrival rather than on state.
 *
 * This is that door. It is the same assembly `fulfillment-log-pass.ts` does -
 * `readFulfillmentsForOrders` -> filter `isLiveFulfillment` -> one
 * {@link FulfillmentLineToRelieve} per line -> `relieveFulfillmentLines` -
 * with the order ids coming from a sweep of the org instead of from a
 * manifest. Deliberately the same shape, so the two paths cannot drift: if
 * the sync pass's assembly changes, this one is wrong in the same way and the
 * parity is visible in review.
 *
 * ## It is SAFE to run repeatedly, and that is arithmetic, not a guard
 *
 * Relief's delta is `quantity - (quantityRelieved ?? 0)`, and
 * `fulfillment_line_quantity_relieved` is re-SUMmed from the line's own `sale`
 * movements by `field-hooks/post/fulfillment-line-rollups.ts`. A line that is
 * already fully relieved computes a delta of zero, writes no movement, and is
 * counted in `skippedZeroDelta`. So this can be run over an entire
 * organization without a cursor, a watermark or an idempotency key.
 *
 * 🛑 **The corollary is the trap.** That same arithmetic means a line whose
 * movements were deleted WITHOUT its roll-up being reset is un-relievable
 * forever: the roll-up still reads the old total, the delta is zero, and this
 * function will happily report success having written nothing. Deleting `sale`
 * movements and clearing `fulfillment_line_quantity_relieved` is ONE
 * operation, never two - see `scripts/reset-books-keep-source.ts`, which is
 * the only thing in the tree that deletes them.
 *
 * ## Order matters against the builds backfill
 *
 * Relief prices at the part's frozen `part_standard_cost` (73 §6.2 rule 3) and
 * skips a line whose part has none, counting it as `skippedNoCost`. Run this
 * BEFORE the builds backfill has given assembled parts a standard and every
 * sale line of one is skipped - not an error, and not loud. Builds first, then
 * relief.
 *
 * No permission checks. A router that exposes this asserts first
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { isLiveFulfillment, readFulfillmentsForOrders } from '../../sales/fulfillments'
import { guard } from './guard'
import { type FulfillmentLineToRelieve, relieveFulfillmentLines } from './relieve'

const logger = createScopedLogger('relief')

/**
 * Orders per batch.
 *
 * `readFulfillmentsForOrders` is four statements whatever the order count, and
 * `relieveFulfillmentLines` is bounded by its own `MAX_IDS_PER_QUERY`
 * chunking, so this number is about MEMORY and about blast radius, not about
 * round trips: one batch is one `relieveFulfillmentLines` call, and a batch
 * that fails loses only its own orders.
 *
 * 250 orders is ~400 fulfillments and ~550 lines on the shape this was
 * measured against (DemoOrg1, 6,534 orders / 7,468 fulfillments / 10,401
 * lines), which keeps a run to ~27 batches.
 */
const ORDERS_PER_BATCH = 250

export interface BackfillFulfillmentReliefInput {
  organizationId: string
  /** Defaults to the organization's system user, as the sync pass uses. */
  userId?: string
  /**
   * Restrict the sweep to these orders. Defaults to every non-archived order
   * the organization has.
   */
  orderIds?: readonly string[]
  /** Called after each batch, for a script's progress line. */
  onBatch?: (progress: BackfillReliefProgress) => void
}

export interface BackfillReliefProgress {
  /** 1-based. */
  batch: number
  batches: number
  ordersDone: number
  movementsWritten: number
}

/**
 * What a run did. Every count is a SUM over the batches; the per-run semantics
 * of each field are `RelieveFulfillmentLinesResult`'s, unchanged.
 */
export interface BackfillFulfillmentReliefSummary {
  ordersScanned: number
  fulfillmentsScanned: number
  /** Cancelled fulfillments, excluded by `isLiveFulfillment` before pricing. */
  fulfillmentsSkippedCancelled: number
  linesConsidered: number
  movementsWritten: number
  affectedPartIds: string[]
  /** No `line_item_part`. */
  skippedNoPart: number
  /** Already relieved - the idempotent case, and the expected one on a re-run. */
  skippedZeroDelta: number
  /** A real delta that could not be priced at all. Never written at zero. */
  skippedNoCost: number
  negativeQoHPartIds: string[]
  /**
   * Batches whose `relieveFulfillmentLines` call returned an error. The run
   * CONTINUES past one - a single batch's failure must not lose the other
   * 26 - so a non-zero count here means the summary is partial and the run
   * should be repeated. Repeating is free (see the header).
   */
  batchesFailed: number
}

/** Every non-archived `order` instance id for the organization. */
async function readOrderIds(db: Database, organizationId: string): Promise<string[]> {
  const orderDefId = await requireCachedEntityDefId(organizationId, 'order')
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, orderDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return rows.map((row) => row.id)
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * Relieve every live fulfillment line the organization holds that still owes
 * units, in batches of orders.
 *
 * Idempotent: a line already relieved contributes to `skippedZeroDelta` and
 * writes nothing.
 */
export async function backfillFulfillmentRelief(
  db: Database,
  input: BackfillFulfillmentReliefInput
): Promise<Result<BackfillFulfillmentReliefSummary, Error>> {
  const { organizationId, onBatch } = input

  return guard(
    async () => {
      const userId = input.userId ?? (await getOrgCache().get(organizationId, 'systemUser'))
      const orderIds = input.orderIds
        ? [...new Set(input.orderIds)]
        : await readOrderIds(db, organizationId)

      const summary: BackfillFulfillmentReliefSummary = {
        ordersScanned: orderIds.length,
        fulfillmentsScanned: 0,
        fulfillmentsSkippedCancelled: 0,
        linesConsidered: 0,
        movementsWritten: 0,
        affectedPartIds: [],
        skippedNoPart: 0,
        skippedZeroDelta: 0,
        skippedNoCost: 0,
        negativeQoHPartIds: [],
        batchesFailed: 0,
      }
      if (orderIds.length === 0) return summary

      // Accumulated as sets: a part is `affected` once however many batches
      // touched it, and a part that went negative in three is one warning.
      const affectedPartIds = new Set<string>()
      const negativeQoHPartIds = new Set<string>()

      const batches = chunk(orderIds, ORDERS_PER_BATCH)
      let ordersDone = 0

      for (const [index, batchOrderIds] of batches.entries()) {
        const byOrder = await readFulfillmentsForOrders(db, {
          organizationId,
          orderIds: batchOrderIds,
        })

        const lines: FulfillmentLineToRelieve[] = []
        for (const [orderId, fulfillments] of byOrder.entries()) {
          for (const fulfillment of fulfillments) {
            summary.fulfillmentsScanned++
            // The CALLER filters cancelled dispatches, never
            // `relieveFulfillmentLines` - `fulfillment-log-pass.ts` makes the
            // same call in the same place, and relief only ever sees lines a
            // caller decided are live.
            if (!isLiveFulfillment(fulfillment)) {
              summary.fulfillmentsSkippedCancelled++
              continue
            }
            // The dispatch's OWN date, so a movement written today still lands
            // in the accounting month the goods left in.
            const occurredAt = new Date(fulfillment.shippedAt)
            for (const line of fulfillment.lines) {
              lines.push({
                fulfillmentLineId: line.id,
                fulfillmentId: fulfillment.id,
                orderId,
                lineItemId: line.lineItemId,
                quantity: line.quantity,
                quantityRelieved: line.quantityRelieved,
                occurredAt,
              })
            }
          }
        }

        ordersDone += batchOrderIds.length
        summary.linesConsidered += lines.length

        if (lines.length > 0) {
          const result = await relieveFulfillmentLines(db, { organizationId, userId, lines })
          if (result.isErr()) {
            // One batch, not the run. See `batchesFailed`.
            summary.batchesFailed++
            logger.error('relief backfill batch failed', {
              organizationId,
              batch: index + 1,
              orders: batchOrderIds.length,
              error: result.error.message,
            })
          } else {
            const value = result.value
            summary.movementsWritten += value.movementIds.length
            summary.skippedNoPart += value.skippedNoPart
            summary.skippedZeroDelta += value.skippedZeroDelta
            summary.skippedNoCost += value.skippedNoCost
            for (const id of value.affectedPartIds) affectedPartIds.add(id)
            for (const id of value.negativeQoHPartIds) negativeQoHPartIds.add(id)
          }
        }

        onBatch?.({
          batch: index + 1,
          batches: batches.length,
          ordersDone,
          movementsWritten: summary.movementsWritten,
        })
      }

      summary.affectedPartIds = [...affectedPartIds]
      summary.negativeQoHPartIds = [...negativeQoHPartIds]

      logger.info('relief backfill done', {
        organizationId,
        ordersScanned: summary.ordersScanned,
        fulfillmentsScanned: summary.fulfillmentsScanned,
        linesConsidered: summary.linesConsidered,
        movementsWritten: summary.movementsWritten,
        skippedZeroDelta: summary.skippedZeroDelta,
        skippedNoCost: summary.skippedNoCost,
        batchesFailed: summary.batchesFailed,
      })

      return summary
    },
    'Failed to backfill fulfillment relief',
    { organizationId }
  )
}

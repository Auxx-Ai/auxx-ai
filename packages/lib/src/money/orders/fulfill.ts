// packages/lib/src/money/orders/fulfill.ts

/**
 * Fulfilling an order: recording what shipped, flipping the fulfillment status,
 * and posting the revenue entry that goes with it.
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## Why this is an ACTION and not a status hook
 *
 * `order` has no lifecycle hook (`resources/hooks/order-hooks.ts`: "neither
 * `order_financial_status` nor `order_fulfillment_status` has a sanctioned
 * action that carries side effects"), so a fulfillment builder has nothing to
 * hang on. The two candidates were a field pre-hook on
 * `order_fulfillment_status` moving to `fulfilled | partial`, and a sanctioned
 * action. Handoff decision 6.6 takes the action, and the reason is partial
 * fulfillment: a status flip cannot carry WHAT shipped, and without that the
 * entry can only ever recognise the whole order.
 *
 * ## Order of operations, and why it is this order
 *
 * The shipment log and the status flip are written in ONE transaction, then the
 * entry is posted AFTER it commits - a provider call inside an open transaction
 * holds the claim's index tuple for an HTTP round trip. `createBankDeposit` is
 * the same shape, and for the same reason.
 *
 * 🛑 **A refused post is rolled back**, exactly as a refused deposit is: the
 * appended shipment is removed and the status is restored, so a locked period
 * or an unmapped role leaves no half-state and the same units can be shipped
 * again once the operator has fixed what the message names. That is NOT a
 * correct-by-editing exception - nothing was posted, so there is nothing to
 * reverse.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../errors'
import {
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
} from '../../postings/build-fulfillment-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY, postEntry, previewEntry } from '../../postings/post-entry'
import type { EntryPreview, PostResult } from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  type OrderFulfillment,
  type OrderFulfillmentsEnvelope,
  shippedSubtotalMinor,
} from './client'
import { guard } from './guard'
import {
  type OrderForFulfillment,
  parseFulfillments,
  readOrderForFulfillment,
  requireOrderFieldContext,
} from './reads'

const logger = createScopedLogger('money-orders')

/**
 * The `postEntry` statuses that mean the ledger accepted the shipment.
 *
 * `not_connected` and `disabled` are in the set on purpose: an org with no
 * accounting system connected is a first-class case, not a degraded one
 * (decision P1). The entry is built, balanced and persisted the same way; it is
 * simply never pushed.
 */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

/** One line, and how much of it the caller says went out. */
export interface FulfillOrderLine {
  lineId: string
  /** Units shipped now. Must be > 0 and no more than what remains. */
  quantity: number
}

export interface FulfillOrderInput {
  organizationId: string
  actorUserId: string
  /** The `order` EntityInstance id. */
  orderId: string
  /** What shipped. A line the caller omits simply did not ship. */
  shippedLines: FulfillOrderLine[]
  /** `YYYY-MM-DD`. The date the goods went out. Defaults to today. */
  shippedAt?: string
  memo?: string
}

export interface FulfillOrderResult {
  /** The shipment as it was recorded on the order. */
  fulfillment: OrderFulfillment
  /**
   * The order's `order_fulfillment_status` AFTER this call - and therefore the
   * status it had before, unchanged, when the ledger refused and the shipment
   * was rolled back.
   */
  fulfillmentStatus: string
  /**
   * What the ledger did.
   *
   * 🛑 A refusal arrives HERE, as a status, not as an `Err`. `postEntry` never
   * throws, and a locked period or an unmapped role is a card the screen renders
   * (`EntryBlockers`), not an exception. An `Err` from this function means the
   * shipment itself was refused - a quantity over the remainder, a foreign
   * currency, an unmapped channel - and nothing was written at all.
   */
  post: PostResult
}

/** `YYYY-MM-DD`, and nothing else. A posting's date is a contract, not a hint. */
function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${label} must be a YYYY-MM-DD date, got "${value}"`)
  }
}

/**
 * Validate what the caller says shipped against what is actually left, and
 * shape it for the builder.
 *
 * Refuses rather than clamps. Clamping a shipment of 5 down to a remainder of 3
 * would post an entry for a number the person never entered and leave them
 * believing 5 shipped.
 */
function resolveShippedLines(
  order: OrderForFulfillment,
  requested: FulfillOrderLine[]
): Array<{ lineId: string; quantity: number; unitPriceMinor: number; name: string }> {
  const byId = new Map(order.lines.map((line) => [line.lineId, line]))
  const seen = new Set<string>()
  const resolved: Array<{
    lineId: string
    quantity: number
    unitPriceMinor: number
    name: string
  }> = []

  for (const request of requested) {
    if (seen.has(request.lineId)) {
      throw new UnprocessableEntityError(
        `Line ${request.lineId} appears twice in this shipment. Ship it once, with the total ` +
          'quantity.',
        { orderId: order.orderId, lineId: request.lineId }
      )
    }
    seen.add(request.lineId)

    const line = byId.get(request.lineId)
    if (!line) {
      throw new UnprocessableEntityError(
        `Line ${request.lineId} is not on order ${order.number ?? order.orderId}.`,
        { orderId: order.orderId, lineId: request.lineId }
      )
    }
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) continue
    if (request.quantity > line.remainingQuantity) {
      throw new UnprocessableEntityError(
        `"${line.name}" has ${line.remainingQuantity} left to ship and this shipment says ` +
          `${request.quantity}. Shipping more than remains would recognise the same revenue ` +
          'twice - the entry would balance and nothing downstream could see it.',
        {
          orderId: order.orderId,
          lineId: line.lineId,
          remaining: String(line.remainingQuantity),
          requested: String(request.quantity),
        }
      )
    }
    resolved.push({
      lineId: line.lineId,
      quantity: request.quantity,
      unitPriceMinor: line.unitPriceMinor,
      name: line.name,
    })
  }

  if (resolved.length === 0) {
    throw new UnprocessableEntityError(
      `Nothing was shipped on order ${order.number ?? order.orderId}. Enter a quantity on at ` +
        'least one line.',
      { orderId: order.orderId }
    )
  }
  return resolved
}

/**
 * Build the entry this shipment would post, without writing anything.
 *
 * Runs the SAME builder and the same resolver `fulfillOrder` runs, so what the
 * dialog shows is what the write would freeze. A refusal comes back as
 * `preview.blockedBy`, which is what `EntryBlockers` renders.
 */
export async function previewFulfillment(
  db: Database,
  params: {
    organizationId: string
    orderId: string
    shippedLines: FulfillOrderLine[]
    shippedAt?: string
  }
): Promise<Result<EntryPreview & { order: OrderForFulfillment }, Error>> {
  const { organizationId, orderId, shippedLines } = params

  return guard(
    async () => {
      const shippedAt = params.shippedAt ?? new Date().toISOString().slice(0, 10)
      assertIsoDate(shippedAt, 'Shipped date')

      const read = await readOrderForFulfillment(db, { organizationId, orderId })
      if (read.isErr()) throw read.error
      const order = read.value

      const { built } = buildForOrder(order, shippedLines, shippedAt)
      const lock = await resolvePeriodLock(organizationId)
      const preview = await previewEntry(db, { organizationId, entry: built.entry, lock })
      return { ...preview, order }
    },
    'Failed to preview a fulfillment',
    { organizationId, orderId }
  )
}

/** A validated shipment: what the builder took, kept for the log. */
interface ResolvedShipment {
  built: BuiltFulfillmentEntry
  lines: ReturnType<typeof resolveShippedLines>
}

/** The one construction site: `readOrderForFulfillment`'s shape -> a `BuiltEntry`. */
function buildForOrder(
  order: OrderForFulfillment,
  shippedLines: FulfillOrderLine[],
  shippedAt: string
): ResolvedShipment {
  const resolved = resolveShippedLines(order, shippedLines)
  const built = buildFulfillmentEntry({
    orderId: order.orderId,
    orderNumber: order.number ?? '',
    sequence: order.nextSequence,
    channel: order.channel,
    currency: order.currency,
    // The one authority for the book currency. Passed in rather than imported by
    // the builder, which stays pure and client-safe.
    ledgerCurrency: LEDGER_CURRENCY,
    txnDate: shippedAt,
    shippedLines: resolved,
    orderSubtotalMinor: order.subtotalMinor,
    orderTaxTotalMinor: order.taxTotalMinor,
    orderShippingTotalMinor: order.shippingTotalMinor,
    // What the earlier shipments already recognised, so the builder allocates
    // tax CUMULATIVELY and the rounding remainder lands on whichever shipment
    // completes the order. Zero on the first shipment, which is the same
    // arithmetic the single-shipment case has always done.
    priorShipmentsSubtotalMinor: shippedSubtotalMinor(order.fulfillments),
    includeShipping: order.shippingOwed,
    // 🛑 DARK. See `build-fulfillment-entry.ts`'s header: a per-fulfillment COGS
    // leg is a second writer of `inventory_finished_goods`, which the L1
    // month-end entry asserts. It turns on with the rest of L3, as ONE change.
    includeCogs: false,
  })
  return { built, lines: resolved }
}

/**
 * Record a shipment against an order and post the revenue it recognises.
 *
 * @throws nothing - every business refusal comes back as an `Err`, and every
 *   ledger refusal as `result.post.status`.
 */
export async function fulfillOrder(
  db: Database,
  input: FulfillOrderInput
): Promise<Result<FulfillOrderResult, Error>> {
  const { organizationId, actorUserId, orderId, shippedLines, memo } = input

  return guard(
    async () => {
      const shippedAt = input.shippedAt ?? new Date().toISOString().slice(0, 10)
      assertIsoDate(shippedAt, 'Shipped date')

      const read = await readOrderForFulfillment(db, { organizationId, orderId })
      if (read.isErr()) throw read.error
      const order = read.value

      // Everything that can refuse, refused BEFORE anything is written: the
      // channel, the currency, the quantities and the document-number keyspace
      // all throw out of here, and none of them can be fixed by retrying.
      const { built, lines: shipped } = buildForOrder(order, shippedLines, shippedAt)

      const fulfillment: OrderFulfillment = {
        sequence: order.nextSequence,
        shippedAt,
        lines: shipped.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
        subtotalMinor: built.subtotalMinor,
        totalMinor: built.totalMinor,
        shippingRecognised: built.shippingMinor > 0,
        glPostingId: null,
        docNumber: null,
        recordedAt: new Date().toISOString(),
      }

      // What the order's lines look like AFTER this shipment - the status is a
      // consequence of the remainder, never a caller's assertion.
      const remainingAfter = order.lines.map((line) => {
        const now = shipped.find((row) => row.lineId === line.lineId)?.quantity ?? 0
        return { ...line, remainingQuantity: Math.max(0, line.remainingQuantity - now) }
      })
      const fulfillmentStatus = fulfillmentStatusFor(remainingAfter)

      // ── The log and the status, in one transaction ─────────────────────
      //
      // 🛑 The log is re-read INSIDE the transaction and appended to what is
      // actually stored, never to the copy `readOrderForFulfillment` returned.
      // `order_fulfillments` is one JSON cell and every write of it is a
      // whole-cell replace, so appending to a stale copy is a lost update: two
      // shipments recorded seconds apart write `[A]` and `[B]` over each other
      // and one of them vanishes. What makes that expensive rather than merely
      // annoying is `shippedByLine` - the vanished shipment's units read as
      // UNSHIPPED, so the next fulfillment re-ships them and recognises their
      // revenue a second time, against a NEW sequence, so the claim's unique
      // index cannot catch it either.
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        await lockOrder(txDb, organizationId, orderId)
        const stored = await readStoredFulfillments(txDb, organizationId, orderId)

        // The compare-and-set. The entry was already built against
        // `order.nextSequence` and its document number is keyed on it, so a log
        // that has moved makes this whole attempt stale: appending anyway would
        // either duplicate a sequence or claim a period key another shipment
        // already holds, and `already_posted` is a SUCCESS status - the second
        // shipment would silently recognise nothing.
        if (nextFulfillmentSequence(stored) !== order.nextSequence) {
          throw new ConflictError(
            `Another shipment was recorded against ${order.number ?? orderId} while this one ` +
              'was being prepared. Nothing was written - reopen the order and ship the ' +
              'quantities that are still outstanding.',
            { orderId, expectedSequence: String(order.nextSequence) }
          )
        }

        const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
        await txCrud.update(order.recordId, {
          order_fulfillments: fulfillmentsEnvelope([...stored, fulfillment]),
          order_fulfillment_status: fulfillmentStatus,
        })
      })

      // ── The posting, after the commit ──────────────────────────────────
      const lock = await resolvePeriodLock(organizationId)
      const post = await postEntry(db, {
        organizationId,
        entry: built.entry,
        actorUserId,
        lock,
        memo: memo ?? `Fulfilled ${order.number ?? orderId} shipment ${order.nextSequence}`,
      })

      if (!ACCEPTED_POST_STATUSES.has(post.status)) {
        await rollbackFulfillment(db, organizationId, actorUserId, order, order.nextSequence)
        logger.warn('Fulfillment rolled back - the ledger refused the entry', {
          organizationId,
          orderId,
          sequence: order.nextSequence,
          status: post.status,
          error: post.error,
        })
        // The status the order is back on, not the one this attempt wanted.
        return {
          fulfillment,
          fulfillmentStatus: order.fulfillmentStatus ?? 'unfulfilled',
          post,
        }
      }

      // Stamp the posting onto the shipment it belongs to, so the order can
      // name its entry without a join.
      //
      // 🛑 Re-read again, and REPLACE the one row by sequence rather than
      // rebuilding the log from the pre-read copy. Between the commit above and
      // this write another shipment can land; rebuilding would drop it and put
      // its units back into "unshipped", where the next fulfillment would
      // re-ship them and recognise their revenue twice.
      const settled: OrderFulfillment = {
        ...fulfillment,
        glPostingId: post.glPostingId ?? null,
        docNumber: post.docNumber ?? null,
      }
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        await lockOrder(txDb, organizationId, orderId)
        const stored = await readStoredFulfillments(txDb, organizationId, orderId)
        const stamped = stored.map((row) => (row.sequence === settled.sequence ? settled : row))
        const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
        await txCrud.update(order.recordId, {
          order_fulfillments: fulfillmentsEnvelope(stamped),
        })
      })

      logger.info('Fulfilled an order', {
        organizationId,
        orderId,
        number: order.number,
        sequence: settled.sequence,
        totalMinor: settled.totalMinor,
        revenueRole: built.revenueRole,
        status: post.status,
      })

      return { fulfillment: settled, fulfillmentStatus, post }
    },
    'Failed to fulfil an order',
    { organizationId, orderId }
  )
}

/**
 * Wrap the log in the envelope the JSON column actually stores.
 *
 * 🛑 **The wrapper is not decoration.** A `FieldValue` write treats a top-level
 * ARRAY as a multi-value write - one row per element - and `order_fulfillments`
 * is single-value, so a bare array is rejected with "single-value; received N
 * values"... which `UnifiedCrudHandler.setFieldValues` LOGS and swallows,
 * leaving the update reporting success over an order whose shipment log is
 * empty. The next fulfillment would then re-ship everything. Slot 1A found this
 * by driving the identical path for `journal_entry_lines`.
 */
function fulfillmentsEnvelope(fulfillments: OrderFulfillment[]): OrderFulfillmentsEnvelope {
  return { fulfillments }
}

/**
 * Take `SELECT ... FOR UPDATE` on the order row, inside the caller's
 * transaction.
 *
 * `order_fulfillments` is a single JSON cell and every write of it is a
 * whole-cell replace, so read-modify-write on it is only safe under a lock that
 * both writers contend on. The `EntityInstance` row is the only such thing: the
 * `FieldValue` row exists, but a reader that has not seen it yet cannot lock it.
 */
async function lockOrder(db: Database, organizationId: string, orderId: string): Promise<void> {
  await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, orderId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .for('update')
}

/**
 * The shipment log as it stands in the database RIGHT NOW.
 *
 * Deliberately not `readOrderForFulfillment`: that reads the lines, the totals,
 * the channel and the currency, none of which this needs, and it is the read
 * whose staleness is the problem in the first place. Parsed by the same
 * tolerant {@link parseFulfillments} every other reader uses, so a row this
 * module cannot understand is dropped identically everywhere.
 */
async function readStoredFulfillments(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<OrderFulfillment[]> {
  const ctx = await requireOrderFieldContext(organizationId)
  const fieldId = ctx.order.order_fulfillments?.id
  if (!fieldId) return []

  const [row] = await db
    .select({ valueJson: schema.FieldValue.valueJson })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, orderId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)

  return parseFulfillments(row?.valueJson)
}

/**
 * Undo a shipment whose posting was refused: drop it from the log and restore
 * the status.
 *
 * A compensating write rather than one transaction with the post, because
 * `postEntry` opens its own transaction and makes a network call. Failures here
 * are logged and swallowed: the caller is already carrying a refusal, and
 * replacing it with a rollback error would hide the thing that actually went
 * wrong.
 *
 * 🛑 It REMOVES this shipment's row from the stored log rather than writing the
 * pre-read copy back. Writing the copy back would also erase any shipment that
 * landed in between, and an erased shipment reads as unshipped units, which the
 * next fulfillment re-ships and re-recognises.
 */
async function rollbackFulfillment(
  db: Database,
  organizationId: string,
  actorUserId: string,
  order: OrderForFulfillment,
  attemptedSequence: number
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Database
      await lockOrder(txDb, organizationId, order.orderId)
      const stored = await readStoredFulfillments(txDb, organizationId, order.orderId)
      const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
      await txCrud.update(order.recordId, {
        order_fulfillments: fulfillmentsEnvelope(
          stored.filter((row) => row.sequence !== attemptedSequence)
        ),
        // Back to whatever it was, including `unfulfilled` - restoring it to the
        // status this attempt would have set would leave the order claiming a
        // shipment the ledger refused.
        order_fulfillment_status: order.fulfillmentStatus ?? 'unfulfilled',
      })
    })
  } catch (error) {
    logger.error('Failed to roll back a refused fulfillment', {
      orderId: order.orderId,
      attemptedSequence,
      error,
    })
  }
}

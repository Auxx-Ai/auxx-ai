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
 * The `fulfillment` record and the status flip are written in ONE transaction,
 * then the entry is posted AFTER it commits - a provider call inside an open
 * transaction holds the claim's index tuple for an HTTP round trip.
 * `createBankDeposit` is the same shape, and for the same reason.
 *
 * 🛑 **A refused post is rolled back**, exactly as a refused deposit is: the
 * `fulfillment` record just created is DELETED and the status is restored, so
 * a locked period or an unmapped role leaves no half-state and the same units
 * can be shipped again once the operator has fixed what the message names.
 * That is NOT a correct-by-editing exception - nothing was posted, so there is
 * nothing to reverse.
 *
 * ## Entity migration 153 (`plans/money/tasks/55-shipment-lines.md` §6.1)
 *
 * The shipment used to be one JSON cell on `order`, and every write of it was
 * a whole-cell replace under a `SELECT ... FOR UPDATE` lock - the log had to
 * be re-read inside the transaction because appending to a stale copy would
 * silently drop a concurrent shipment. Real `fulfillment` / `fulfillment_line`
 * records have none of that hazard: creating a row and creating another row
 * cannot stomp on each other the way two whole-cell replaces can, so the lock,
 * the re-read and the compare-and-set are gone, and the rollback path is now a
 * plain delete instead of a hand-rolled "remove this entry from the array"
 * rewrite. `money/fulfillments/writes.ts` is where all three writes live now.
 *
 * ⚠️ **What is NOT closed by this simplification**: two fulfillments of the
 * same order created within the same read-then-write window can still both
 * compute the same `nextSequence` from {@link readOrderForFulfillment}'s
 * snapshot, since nothing here re-checks it under a lock before writing (the
 * brief calls this out as the intended trade - see its §6.1 and this
 * function's own read of `order.nextSequence` below). A duplicate sequence is
 * a cosmetic defect, not a books one: `fulfillment_gl_posting IS NULL` is what
 * the poster's idempotency actually keys on, not the sequence number.
 *
 * @see plans/accounting/tasks/01-post-revenue-to-the-ledger.md
 * @see plans/money/tasks/55-shipment-lines.md
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
  computeShipmentTotals,
  type ShipmentTotals,
} from '../../postings/build-fulfillment-entry'
import { isExpectedPostOutcome } from '../../postings/ledger-accepted'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY, postEntry, previewEntry } from '../../postings/post-entry'
import type { EntryPreview, PostResult } from '../../postings/types'
import { type FulfillmentLineToRelieve, relieveFulfillmentLines } from '../../relief'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import {
  type CreatedFulfillment,
  type CreateFulfillmentLineInput,
  createFulfillment,
  defaultFulfillmentName,
  deleteFulfillment,
  type Fulfillment,
  stampFulfillmentPosting,
} from '../fulfillments'
import { fulfillmentStatusFor, type OrderLineRemaining, shippedSubtotalMinor } from './client'
import { guard } from './guard'
import { type OrderForFulfillment, readOrderForFulfillment } from './reads'

const logger = createScopedLogger('money-orders')

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
  /** The `fulfillment` record this call created (and possibly then rolled back). */
  fulfillment: Fulfillment
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
 * A calendar day as the noon-UTC instant `fulfillment_shipped_at` (a DATETIME
 * field) stores. Noon rather than midnight so no timezone's local rendering of
 * the instant crosses into the adjacent calendar day - the same convention
 * `money/credit-memos/writes.ts`'s `calendarDayToInstant` uses for
 * `credit_memo_issued_at`.
 */
function calendarDayToInstant(day: string): string {
  return `${day}T12:00:00.000Z`
}

/**
 * This line's tax for the units that actually shipped, or `undefined` when the
 * sales channel supplied no per-line tax at all.
 *
 * 🛑 `undefined` is the honest answer to "we were told nothing", and it is what
 * makes `buildFulfillmentEntry` fall back to allocating the ORDER's tax. Zero
 * would claim the channel said this line is untaxed, and one such line among
 * taxed ones would still count as "every line carries tax", so the entry would
 * switch to the per-line basis and under-credit `sales_tax_payable` silently.
 *
 * A partial shipment scales pro rata on units and rounds, matching
 * `computeShipmentAmounts` in `postings/build-fulfillment-batch-entry.ts` so
 * the single-order and bulk paths cannot disagree about one line's tax.
 */
function shippedLineTaxMinor(line: OrderLineRemaining, quantity: number): number | undefined {
  if (line.lineTaxMinor == null) return undefined
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) return undefined
  if (quantity >= line.quantity) return line.lineTaxMinor
  return Math.round((line.lineTaxMinor * quantity) / line.quantity)
}

/** One validated shipped line, in the shape `buildFulfillmentEntry` takes. */
interface ResolvedShippedLine {
  lineId: string
  quantity: number
  unitPriceMinor: number
  /** Present only when the line carries `line_item_tax_total`. */
  taxMinor?: number
  name: string
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
): ResolvedShippedLine[] {
  const byId = new Map(order.lines.map((line) => [line.lineId, line]))
  const seen = new Set<string>()
  const resolved: ResolvedShippedLine[] = []

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
    const taxMinor = shippedLineTaxMinor(line, request.quantity)
    resolved.push({
      lineId: line.lineId,
      quantity: request.quantity,
      unitPriceMinor: line.unitPriceMinor,
      ...(taxMinor === undefined ? {} : { taxMinor }),
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
    contactInstanceId: order.contactInstanceId,
    taxLines: order.taxLines,
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

      // The quantities are validated regardless of accounting: shipping more
      // than remains is a business error, not a ledger one.
      const shipped = resolveShippedLines(order, shippedLines)
      const sequence = order.nextSequence

      // 🛑 The org's own accounting-off case is checked FIRST, before the
      // ledger entry is built (task 17 section 3): `buildFulfillmentEntry`
      // refuses a foreign-currency order and resolves a revenue role, both of
      // which are ledger-only concerns that must not block a shipment for an
      // org this module does nothing for. `computeShipmentTotals` is the same
      // arithmetic with none of that - the shared implementation the batch
      // builder also calls - so the fulfillment record still carries real
      // amounts.
      const accountingEnabled = await isAccountingEnabled(db, organizationId)
      const built = accountingEnabled
        ? buildFulfillmentEntry({
            orderId: order.orderId,
            orderNumber: order.number ?? '',
            sequence,
            channel: order.channel,
            currency: order.currency,
            ledgerCurrency: LEDGER_CURRENCY,
            txnDate: shippedAt,
            shippedLines: shipped,
            orderSubtotalMinor: order.subtotalMinor,
            orderTaxTotalMinor: order.taxTotalMinor,
            orderShippingTotalMinor: order.shippingTotalMinor,
            priorShipmentsSubtotalMinor: shippedSubtotalMinor(order.fulfillments),
            includeShipping: order.shippingOwed,
            includeCogs: false,
            contactInstanceId: order.contactInstanceId,
            taxLines: order.taxLines,
          })
        : undefined
      const amounts: ShipmentTotals =
        built ??
        computeShipmentTotals({
          label: `order ${order.number ?? order.orderId}`,
          lines: shipped,
          orderSubtotalMinor: order.subtotalMinor,
          orderTaxTotalMinor: order.taxTotalMinor,
          priorShipmentsSubtotalMinor: shippedSubtotalMinor(order.fulfillments),
          orderShippingTotalMinor: order.shippingTotalMinor,
          includeShipping: order.shippingOwed,
          context: { orderId: order.orderId },
        })

      const shippedAtInstant = calendarDayToInstant(shippedAt)
      const recordedAt = new Date().toISOString()
      const shippingRecognised = amounts.shippingMinor > 0
      const name = defaultFulfillmentName(order.number, sequence)
      const createLines: CreateFulfillmentLineInput[] = shipped.map((line) => ({
        lineItemInstanceId: line.lineId,
        quantity: line.quantity,
      }))

      // What the order's lines look like AFTER this shipment - the status is a
      // consequence of the remainder, never a caller's assertion.
      const remainingAfter = order.lines.map((line) => {
        const now = shipped.find((row) => row.lineId === line.lineId)?.quantity ?? 0
        return { ...line, remainingQuantity: Math.max(0, line.remainingQuantity - now) }
      })
      const fulfillmentStatus = fulfillmentStatusFor(remainingAfter)

      // ── The record and the status, in one transaction ──────────────────
      let created!: CreatedFulfillment
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        created = await createFulfillment(txDb, {
          organizationId,
          actorUserId,
          orderInstanceId: orderId,
          sequence,
          shippedAt: shippedAtInstant,
          status: 'success',
          name,
          subtotalMinor: amounts.subtotalMinor,
          totalMinor: amounts.totalMinor,
          shippingRecognised,
          recordedAt,
          lines: createLines,
        })

        const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
        await txCrud.update(order.recordId, { order_fulfillment_status: fulfillmentStatus })
      })

      const fulfillment: Fulfillment = {
        id: created.fulfillmentInstanceId,
        recordId: created.recordId,
        orderId,
        sequence,
        shippedAt: shippedAtInstant,
        status: 'success',
        cancelledAt: null,
        name,
        trackingNumber: null,
        trackingCompany: null,
        trackingUrl: null,
        subtotalMinor: amounts.subtotalMinor,
        totalMinor: amounts.totalMinor,
        shippingRecognised,
        glPosting: null,
        docNumber: null,
        recordedAt,
        lines: created.lineInstanceIds.map((id, index) => ({
          id,
          recordId: toRecordId('fulfillment_line', id),
          lineItemId: shipped[index]!.lineId,
          quantity: shipped[index]!.quantity,
          quantityRelieved: null,
        })),
      }

      // ── The posting, after the commit ──────────────────────────────────
      let post: PostResult
      if (accountingEnabled && built) {
        const lock = await resolvePeriodLock(organizationId)
        post = await postEntry(db, {
          organizationId,
          entry: built.entry,
          actorUserId,
          lock,
          memo: memo ?? `Fulfilled ${order.number ?? orderId} shipment ${sequence}`,
        })
      } else {
        post = { status: 'not_enabled' }
      }

      if (!isExpectedPostOutcome(post)) {
        await rollbackFulfillment(
          db,
          organizationId,
          actorUserId,
          order,
          created.fulfillmentInstanceId
        )
        logger.warn('Fulfillment rolled back - the ledger refused the entry', {
          organizationId,
          orderId,
          sequence,
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

      // Stamp the posting onto the fulfillment it belongs to, so the order can
      // name its entry without a join.
      const glPosting = post.glPostingId ?? null
      const docNumber = post.docNumber ?? null
      await stampFulfillmentPosting(db, {
        organizationId,
        actorUserId,
        fulfillmentInstanceId: created.fulfillmentInstanceId,
        patch: { glPosting, docNumber },
      })
      const settled: Fulfillment = { ...fulfillment, glPosting, docNumber }

      // ── Inventory relief (plans/money/tasks/50-batch-inventory-relief.md §1.4) ──
      // 🛑 AFTER `isExpectedPostOutcome(post)`, never before: a refused post
      // rolls the fulfillment record back above, and relief has no record
      // left to point at. Also never gated on `accountingEnabled` - on-hand
      // is an inventory fact, and `not_enabled` reaches here too (it is an
      // EXPECTED outcome), so the accounting-off org still gets a correct
      // shelf. Relief writes on its OWN lane (§1.7), not inside the
      // transaction above, so its failure must not undo a shipment the
      // ledger already accepted - logged and swallowed, matching this
      // function's own "@throws nothing" contract. A freshly created line has
      // never been relieved (`quantityRelieved: null`), so every line here
      // owes its full quantity.
      const reliefLines: FulfillmentLineToRelieve[] = created.lineInstanceIds.map((id, index) => ({
        fulfillmentLineId: id,
        lineItemId: shipped[index]!.lineId,
        quantity: shipped[index]!.quantity,
        quantityRelieved: null,
        occurredAt: new Date(shippedAtInstant),
      }))
      const relief = await relieveFulfillmentLines(db, {
        organizationId,
        userId: actorUserId,
        lines: reliefLines,
      })
      if (relief.isErr()) {
        logger.error('Inventory relief failed for a fulfillment - on-hand is stale until retried', {
          organizationId,
          orderId,
          fulfillmentInstanceId: created.fulfillmentInstanceId,
          error: relief.error.message,
        })
      }

      logger.info('Fulfilled an order', {
        organizationId,
        orderId,
        number: order.number,
        sequence,
        totalMinor: settled.totalMinor,
        revenueRole: built?.revenueRole ?? null,
        status: post.status,
      })

      return { fulfillment: settled, fulfillmentStatus, post }
    },
    'Failed to fulfil an order',
    { organizationId, orderId }
  )
}

/**
 * Undo a fulfillment whose posting was refused: delete the record and restore
 * the order's status.
 *
 * A compensating write rather than one transaction with the post, because
 * `postEntry` opens its own transaction and makes a network call - by the time
 * it returns, the fulfillment record has already committed. Failures here are
 * logged and swallowed: the caller is already carrying a refusal, and
 * replacing it with a rollback error would hide the thing that actually went
 * wrong.
 */
async function rollbackFulfillment(
  db: Database,
  organizationId: string,
  actorUserId: string,
  order: OrderForFulfillment,
  fulfillmentInstanceId: string
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Database
      await deleteFulfillment(txDb, { organizationId, actorUserId, fulfillmentInstanceId })
      const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
      await txCrud.update(order.recordId, {
        // Back to whatever it was, including `unfulfilled` - restoring it to the
        // status this attempt would have set would leave the order claiming a
        // shipment the ledger refused.
        order_fulfillment_status: order.fulfillmentStatus ?? 'unfulfilled',
      })
    })
  } catch (error) {
    logger.error('Failed to roll back a refused fulfillment', {
      orderId: order.orderId,
      fulfillmentInstanceId,
      error,
    })
  }
}

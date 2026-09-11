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
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  type OrderFulfillment,
  type OrderFulfillmentsEnvelope,
  type OrderLineRemaining,
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

      // 🛑 The org's own accounting-off case is checked FIRST, before the
      // ledger entry is built (task 17 section 3): `buildFulfillmentEntry`
      // refuses a foreign-currency order and resolves a revenue role, both of
      // which are ledger-only concerns that must not block a shipment for an
      // org this module does nothing for. `computeShipmentTotals` is the same
      // arithmetic with none of that - the shared implementation the batch
      // builder also calls - so the shipment log still carries real amounts.
      const accountingEnabled = await isAccountingEnabled(db, organizationId)
      const built = accountingEnabled
        ? buildFulfillmentEntry({
            orderId: order.orderId,
            orderNumber: order.number ?? '',
            sequence: order.nextSequence,
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

      const fulfillment: OrderFulfillment = {
        sequence: order.nextSequence,
        shippedAt,
        lines: shipped.map((line) => ({ lineId: line.lineId, quantity: line.quantity })),
        subtotalMinor: amounts.subtotalMinor,
        totalMinor: amounts.totalMinor,
        shippingRecognised: amounts.shippingMinor > 0,
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
      let post: PostResult
      if (accountingEnabled && built) {
        const lock = await resolvePeriodLock(organizationId)
        post = await postEntry(db, {
          organizationId,
          entry: built.entry,
          actorUserId,
          lock,
          memo: memo ?? `Fulfilled ${order.number ?? orderId} shipment ${order.nextSequence}`,
        })
      } else {
        post = { status: 'not_enabled' }
      }

      if (!isExpectedPostOutcome(post)) {
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
      const settled: OrderFulfillment = {
        ...fulfillment,
        glPostingId: post.glPostingId ?? null,
        docNumber: post.docNumber ?? null,
      }
      await stampFulfillment(db, {
        organizationId,
        actorUserId,
        orderId,
        sequence: settled.sequence,
        patch: { glPostingId: settled.glPostingId, docNumber: settled.docNumber },
      })

      logger.info('Fulfilled an order', {
        organizationId,
        orderId,
        number: order.number,
        sequence: settled.sequence,
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
 * What a stamp may change on one shipment. Everything else on the row is
 * history and stays exactly as it was written.
 */
export interface FulfillmentStampPatch {
  /** The `GlPosting` this shipment now belongs to. */
  glPostingId?: string | null
  docNumber?: string | null
  /**
   * The recognised total, when the posting that took the shipment computed a
   * different one from the row's own. The bulk poster does: a group's builder
   * re-derives every shipment's amounts, and the log has to name what was
   * actually posted rather than what a single-order builder once thought.
   */
  totalMinor?: number
  subtotalMinor?: number
}

/**
 * Write a posting's identity back onto ONE shipment of an order's log.
 *
 * Extracted from {@link fulfillOrder}'s post-commit transaction so the bulk
 * poster (`money/fulfillment-posting/run.ts`) stamps through exactly the same
 * three steps. Two writers of one JSON cell that took the lock differently
 * would be the lost update this whole module is built to avoid, and the bulk
 * lane stamps DOZENS of orders per run, so it is the writer that would find it.
 *
 * 🛑 The log is re-read under a `SELECT ... FOR UPDATE` on the order row and the
 * named row is PATCHED in place, rather than the caller's copy being written
 * back. `order_fulfillments` is a single JSON cell and every write of it is a
 * whole-cell replace: between the caller's read and this write another shipment
 * can land, and writing the copy back would drop it. A dropped shipment's units
 * read as UNSHIPPED, so the next fulfillment re-ships them and recognises their
 * revenue a second time - under a new sequence, so the posting claim's unique
 * index cannot catch it either.
 *
 * A sequence that is not in the stored log writes nothing at all. That is the
 * right answer for a shipment somebody removed while the posting was in flight:
 * inventing the row back would resurrect a shipment a person deleted.
 *
 * @throws whatever the transaction throws. The callers are inside a `guard` or
 *   a never-throws run, and a stamp that silently failed would leave a posted
 *   shipment looking unposted - which the netting read would then post again.
 */
export async function stampFulfillment(
  db: Database,
  params: {
    organizationId: string
    /** Who the write is attributed to. The `systemUser` for an unattended run. */
    actorUserId: string
    orderId: string
    /** The `OrderFulfillment.sequence` to stamp. */
    sequence: number
    patch: FulfillmentStampPatch
  }
): Promise<void> {
  const { organizationId, actorUserId, orderId, sequence, patch } = params
  const ctx = await requireOrderFieldContext(organizationId)
  const recordId = toRecordId(ctx.orderDefId, orderId)

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database
    await lockOrder(txDb, organizationId, orderId)
    const stored = await readStoredFulfillments(txDb, organizationId, orderId)
    if (!stored.some((row) => row.sequence === sequence)) return

    const stamped = stored.map((row) => (row.sequence === sequence ? { ...row, ...patch } : row))
    const txCrud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
    await txCrud.update(recordId, { order_fulfillments: fulfillmentsEnvelope(stamped) })
  })
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

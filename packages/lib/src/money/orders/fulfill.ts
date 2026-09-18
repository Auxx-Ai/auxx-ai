// packages/lib/src/money/orders/fulfill.ts

/** Native shipment creation commits operational quantities, then posts revenue right after. */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { calendarDayToInstant, isDayKeyShape } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import {
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
  computeShipmentTotals,
} from '../../accounting/ledger/builders/fulfillment'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { withAccountingCommitLock } from '../../accounting/ledger/post/accounting-commit-lock'
import { readAutoPostMode } from '../../accounting/ledger/post/auto-post'
import {
  exportPostedEntry,
  type InTxPostResult,
  LEDGER_CURRENCY,
  postEntryInTx,
  previewEntry,
} from '../../accounting/ledger/post/post-entry'
import { reverseEntry } from '../../accounting/ledger/post/reverse-entry'
import { listPostingsForSource } from '../../accounting/ledger/reads/list-postings'
import { isAccountingEnabled } from '../../accounting/ledger/setup/accounting-enabled'
import type {
  BuiltEntry,
  EntryPreview,
  GlPostingSourceInput,
  PostResult,
} from '../../accounting/ledger/types'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { type FulfillmentLineToRelieve, relieveFulfillmentLines } from '../../inventory/relief'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { readOrderSourceScope } from '../customer-money/reads'
import { createFulfillment, defaultFulfillmentName, type Fulfillment } from '../fulfillments'
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
  /** The `fulfillment` record this call created. */
  fulfillment: Fulfillment
  /** Operational status after the recorded shipment, including when accounting is pending. */
  fulfillmentStatus: string
  /** Local accounting outcome; a refusal retains the shipment and its recoverable work. */
  post: PostResult
}

/** `YYYY-MM-DD`, and nothing else. A posting's date is a contract, not a hint. */
function assertIsoDate(value: string, label: string): void {
  if (!isDayKeyShape(value)) {
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
 * A partial shipment scales pro rata on units and rounds.
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
  /**
   * The line's whole NET total, its ordered quantity and what earlier
   * fulfillments already took of it - the builder allocates the total by units
   * across a split line so a fractional rate still sums to the line
   * (29 §12 item 6). `lineTotalMinor` is null for a line with no stored total,
   * and the builder then extends the rate as before.
   */
  lineTotalMinor: number | null
  orderedQuantity: number
  priorShippedQuantity: number
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
      lineTotalMinor: line.lineTotalMinor ?? null,
      orderedQuantity: line.quantity,
      // Every earlier fulfillment of the order, the same population
      // `shippedSubtotalMinor` sums for the tax allocation's prior.
      priorShippedQuantity: line.shippedQuantity,
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
      // Task 47 §5. The ENTRY-level door rather than the line-level one: a
      // preview is of one order, so every revenue line on it shares one store.
      // The same predicate the write takes, so what the dialog shows is the
      // account the write will actually credit.
      const scope = await readOrderSourceScope(db, organizationId, orderId)
      const preview = await previewEntry(db, { organizationId, entry: built.entry, lock, scope })
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
  })
  return { built, lines: resolved }
}

/**
 * Post one shipment's revenue: subject the fulfillment, parent the order,
 * counterparty the customer's contact (when the order has one).
 *
 * `storeId` is the `FinancialSourceAccount` the order's revenue resolved
 * through, or `null` for the manual bucket or an ambiguous one - the same
 * `readOrderSourceScope` predicate `previewFulfillment` reads. `railId` is
 * always `null`: a native shipment debits `accounts_receivable`, never a
 * gateway's clearing account (decision D11, `money/fulfillment-posting/work.ts`'s
 * former header), so there is no rail to scope this posting to. That leg
 * belongs to the receipt, which posts through `receipt-accounting.ts` when the
 * money actually settles.
 *
 * Posts inside the fulfillment's own transaction, so the shipment and its entry
 * commit together (MIGRATION follow-up 2). A REFUSAL is not a throw - nothing is
 * written at that point - so a closed month still retains the shipment.
 */
async function postFulfillmentEntryInTx(
  tx: Transaction,
  input: {
    organizationId: string
    orderId: string
    fulfillmentInstanceId: string
    contactInstanceId: string | null
    entry: BuiltEntry
    actorUserId: string
    memo?: string
  }
): Promise<InTxPostResult> {
  const {
    organizationId,
    orderId,
    fulfillmentInstanceId,
    contactInstanceId,
    entry,
    actorUserId,
    memo,
  } = input
  const scope = await readOrderSourceScope(tx, organizationId, orderId)
  const sources: GlPostingSourceInput[] = [
    { sourceKind: 'fulfillment', sourceId: fulfillmentInstanceId, linkRole: 'subject' },
    { sourceKind: 'order', sourceId: orderId, linkRole: 'parent' },
    ...(contactInstanceId
      ? [{ sourceKind: 'contact', sourceId: contactInstanceId, linkRole: 'counterparty' as const }]
      : []),
  ]
  const lock = await resolvePeriodLock(organizationId, tx)
  const mode = await readAutoPostMode(organizationId, 'fulfillment')
  return postEntryInTx(tx, {
    organizationId,
    entry,
    lock,
    scope,
    sources,
    mode,
    storeId: typeof scope.store === 'string' ? scope.store : null,
    railId: null,
    actorUserId,
    memo,
  })
}

/**
 * Reverse a fulfillment's live posting, freeing its claim so the source can
 * post again (TARGET §5: "reverse on cancel or restock").
 *
 * The primitive a cancel or restock action calls before it changes the
 * fulfillment record's own status - this function touches only the ledger.
 * A no-op, returning `null`, when the fulfillment never posted or its posting
 * was already reversed: cancelling an unposted or already-reversed shipment
 * has nothing left to back out.
 */
export async function reverseFulfillmentPosting(
  db: Database,
  input: {
    organizationId: string
    fulfillmentInstanceId: string
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, fulfillmentInstanceId, actorUserId, memo } = input
  const found = await listPostingsForSource(db, {
    organizationId,
    sourceKind: 'fulfillment',
    sourceId: fulfillmentInstanceId,
  })
  if (found.isErr()) throw found.error
  const live = found.value.find(
    (posting) => posting.linkRole === 'subject' && posting.status !== 'reversed'
  )
  if (!live) return null
  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, { organizationId, glPostingId: live.id, actorUserId, lock, memo })
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
      const accountingEnabled = await isAccountingEnabled(db, organizationId)
      const committed = await db.transaction((tx) =>
        runInTxWrite({ organizationId, actorUserId }, async () => {
          await withAccountingCommitLock(tx, organizationId)
          // Quantity checks follow the shared lock so two shipments cannot consume the same remainder.
          const read = await readOrderForFulfillment(tx, { organizationId, orderId })
          if (read.isErr()) throw read.error
          const order = read.value
          const shipped = resolveShippedLines(order, shippedLines)
          const sequence = order.nextSequence
          const priorShipmentsSubtotalMinor = shippedSubtotalMinor(order.fulfillments)
          const amounts = computeShipmentTotals({
            label: `order ${order.number ?? orderId}`,
            lines: shipped,
            orderSubtotalMinor: order.subtotalMinor,
            orderTaxTotalMinor: order.taxTotalMinor,
            priorShipmentsSubtotalMinor,
            orderShippingTotalMinor: order.shippingTotalMinor,
            includeShipping: order.shippingOwed,
            context: { orderId },
          })
          const shippedAtInstant = calendarDayToInstant(shippedAt)
          const recordedAt = new Date().toISOString()
          const name = defaultFulfillmentName(order.number, sequence)
          const created = await createFulfillment(tx, {
            organizationId,
            actorUserId,
            orderInstanceId: orderId,
            sequence,
            shippedAt: shippedAtInstant,
            status: 'success',
            name,
            subtotalMinor: amounts.subtotalMinor,
            totalMinor: amounts.totalMinor,
            shippingRecognised: amounts.shippingMinor > 0,
            recordedAt,
            lines: shipped.map((line) => ({
              lineItemInstanceId: line.lineId,
              quantity: line.quantity,
            })),
          })
          // Frozen inside the same lock and transaction the quantities committed
          // in, so the entry posted right after can never disagree with them.
          const entry = accountingEnabled
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
                priorShipmentsSubtotalMinor,
                includeShipping: order.shippingOwed,
                contactInstanceId: order.contactInstanceId,
                taxLines: order.taxLines,
              }).entry
            : null
          const remainingAfter = order.lines.map((line) => ({
            ...line,
            remainingQuantity: Math.max(
              0,
              line.remainingQuantity -
                (shipped.find((row) => row.lineId === line.lineId)?.quantity ?? 0)
            ),
          }))
          const fulfillmentStatus = fulfillmentStatusFor(remainingAfter)
          const crud = new UnifiedCrudHandler(organizationId, actorUserId, tx)
          await crud.update(order.recordId, { order_fulfillment_status: fulfillmentStatus })
          // The entry commits with the shipment it recognises (follow-up 2).
          const post: InTxPostResult = entry
            ? await postFulfillmentEntryInTx(tx, {
                organizationId,
                orderId,
                fulfillmentInstanceId: created.fulfillmentInstanceId,
                contactInstanceId: order.contactInstanceId,
                entry,
                actorUserId,
                memo,
              })
            : { status: 'not_enabled' }
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
            shippingRecognised: amounts.shippingMinor > 0,
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
          return {
            fulfillment,
            fulfillmentStatus,
            created,
            shipped,
            shippedAtInstant,
            post,
          }
        })
      )
      if (committed.owned) await flushTxWriteScope(committed.scope)
      const { fulfillment, fulfillmentStatus, created, shipped, shippedAtInstant } =
        committed.result

      // The provider push is deliberately outside the transaction: a network
      // call inside one holds the claim's index tuple for an HTTP round trip.
      const { pendingExport, ...written } = committed.result.post
      const post: PostResult = pendingExport ? await exportPostedEntry(db, pendingExport) : written
      fulfillment.glPosting = post.glPostingId ?? null
      fulfillment.docNumber = post.docNumber ?? null
      // Inventory follows the shipment even when bookkeeping refuses; its independent retry owns failures.
      const reliefLines: FulfillmentLineToRelieve[] = created.lineInstanceIds.map((id, index) => ({
        fulfillmentLineId: id,
        fulfillmentId: created.fulfillmentInstanceId,
        orderId,
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
      if (relief.isErr())
        logger.error('Inventory relief remains due for a recorded shipment', {
          organizationId,
          orderId,
          fulfillmentInstanceId: created.fulfillmentInstanceId,
          error: relief.error.message,
        })
      return { fulfillment, fulfillmentStatus, post }
    },
    'Failed to fulfil an order',
    { organizationId, orderId }
  )
}

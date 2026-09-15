// packages/lib/src/money/orders/fulfill.ts

/** Native shipment creation commits operational quantities and durable accounting work together. */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
  computeShipmentTotals,
} from '../../postings/build-fulfillment-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY, previewEntry } from '../../postings/post-entry'
import type { EntryPreview, PostResult } from '../../postings/types'
import { type FulfillmentLineToRelieve, relieveFulfillmentLines } from '../../relief'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { readOrderSourceScope } from '../customer-money/reads'
import { acceptFulfillmentWorkGroup } from '../fulfillment-posting/run'
import { captureFulfillmentAccountingWorkInTx } from '../fulfillment-posting/work'
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
      // The same predicate the effect path takes, so what the dialog shows is
      // the account the acceptance will actually credit.
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
          const amounts = computeShipmentTotals({
            label: `order ${order.number ?? orderId}`,
            lines: shipped,
            orderSubtotalMinor: order.subtotalMinor,
            orderTaxTotalMinor: order.taxTotalMinor,
            priorShipmentsSubtotalMinor: shippedSubtotalMinor(order.fulfillments),
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
          await tx
            .update(schema.EntityInstance)
            .set({
              metadata: sql`COALESCE(${schema.EntityInstance.metadata}, '{}'::jsonb) || '{"accountingFulfillmentLane":"native"}'::jsonb`,
            })
            .where(
              and(
                eq(schema.EntityInstance.organizationId, organizationId),
                eq(schema.EntityInstance.id, created.fulfillmentInstanceId)
              )
            )
          await captureFulfillmentAccountingWorkInTx(tx, {
            organizationId,
            fulfillmentInstanceId: created.fulfillmentInstanceId,
            ...(accountingEnabled ? {} : { eligibility: 'excluded' as const }),
          })
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
          return { fulfillment, fulfillmentStatus, created, shipped, shippedAtInstant }
        })
      )
      if (committed.owned) await flushTxWriteScope(committed.scope)
      const { fulfillment, fulfillmentStatus, created, shipped, shippedAtInstant } =
        committed.result
      let post: PostResult = { status: 'not_enabled' }
      if (accountingEnabled) {
        try {
          const accepted = await acceptFulfillmentWorkGroup(db, {
            organizationId,
            actorUserId,
            fulfillmentIds: [created.fulfillmentInstanceId],
            groupKey: shippedAt,
            memo,
          })
          post = accepted
            ? { status: 'posted', glPostingId: accepted.glPostingId, docNumber: accepted.docNumber }
            : { status: 'error', error: 'The shipment is recorded; accounting is pending review' }
        } catch (error) {
          post = { status: 'error', error: error instanceof Error ? error.message : String(error) }
          logger.warn('Shipment recorded with accounting work pending', {
            organizationId,
            orderId,
            fulfillmentInstanceId: created.fulfillmentInstanceId,
            error: post.error,
          })
        }
      }
      fulfillment.glPosting = post.glPostingId ?? null
      fulfillment.docNumber = post.docNumber ?? null
      // Inventory follows the shipment even when bookkeeping refuses; its independent retry owns failures.
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

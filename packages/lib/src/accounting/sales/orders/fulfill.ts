// packages/lib/src/accounting/sales/orders/fulfill.ts

/** Native shipment creation commits operational quantities, then posts revenue right after. */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { calendarDayToInstant, isDayKeyShape } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { AuxxError, BadRequestError, UnprocessableEntityError } from '../../../errors'
import { type FulfillmentLineToRelieve, relieveFulfillmentLines } from '../../../inventory/relief'
import { flushTxWriteScope } from '../../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../../resources/crud/tx-write-scope'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { toRecordId } from '../../../resources/resource-id'
import { computeShipmentTotals } from '../../ledger/builders/fulfillment'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { withAccountingCommitLock } from '../../ledger/post/accounting-commit-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import {
  exportPostedEntry,
  type InTxPostResult,
  postEntryInTx,
  previewEntry,
} from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { listPostingsForSource } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import type { EntryPreview, PostResult } from '../../ledger/types'
import { refusalFromError, refusalFromPost, type WorkItemRefusal } from '../../work-items/refusal'
import { createFulfillment, defaultFulfillmentName, type Fulfillment } from '../fulfillments'
// The leaves, not the barrel: `../fulfillments` re-exports `stamp-totals.ts`,
// whose real dependency chain (field-value writes, realtime) is exactly what
// `fulfill.test.ts` mocks the barrel to avoid pulling in.
import {
  NothingToRecogniseError,
  type PreparedFulfillmentEntry,
  parkFulfillment,
  prepareFulfillmentEntry,
  prepareShipmentEntry,
  readShipmentPostingWindow,
  type ShipmentToRecognise,
} from '../fulfillments/accounting'
import { type ShipmentLine, shapeShipmentLine } from '../fulfillments/shipment-lines'
import { fulfillmentStatusFor, shippedSubtotalMinor } from './client'
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
 * Validate what the caller says shipped against what is actually left, and
 * shape it for the builder.
 *
 * Refuses rather than clamps. Clamping a shipment of 5 down to a remainder of 3
 * would post an entry for a number the person never entered and leave them
 * believing 5 shipped. The shaping itself - a request plus an order line into
 * `computeShipmentTotals`'s input - is `shapeShipmentLine` (`../fulfillments`),
 * shared with the derived stamp so the two lanes cannot compute a shipment's
 * lines differently.
 */
function resolveShippedLines(
  order: OrderForFulfillment,
  requested: FulfillOrderLine[]
): ShipmentLine[] {
  const byId = new Map(order.lines.map((line) => [line.lineId, line]))
  const seen = new Set<string>()
  const resolved: ShipmentLine[] = []

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
    // `line.shippedQuantity` is every EARLIER fulfillment of the order - the
    // one being built here does not exist yet - the same population
    // `shippedSubtotalMinor` sums for the tax allocation's prior.
    resolved.push(shapeShipmentLine(line, request.quantity, line.shippedQuantity))
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
 * The requested shipment as the sequence walk would see it once written: its
 * lines, its share, and the priors every earlier shipment left. The one
 * arithmetic the preview, the record's stamp and the entry share.
 */
function shapeRequestedShipment(
  order: OrderForFulfillment,
  requested: FulfillOrderLine[],
  shippedAt: string
): ShipmentToRecognise {
  const lines = resolveShippedLines(order, requested)
  const priorSubtotalMinor = shippedSubtotalMinor(order.fulfillments)
  const includeShipping = order.shippingOwed
  const amounts = computeShipmentTotals({
    label: `order ${order.number ?? order.orderId}`,
    lines,
    orderSubtotalMinor: order.subtotalMinor,
    orderTaxTotalMinor: order.taxTotalMinor,
    priorShipmentsSubtotalMinor: priorSubtotalMinor,
    orderShippingTotalMinor: order.shippingTotalMinor,
    includeShipping,
    context: { orderId: order.orderId },
  })
  return {
    // Not written yet; the preview entry still needs a source id.
    id: 'preview',
    sequence: order.nextSequence,
    shippedAt: calendarDayToInstant(shippedAt),
    lines,
    priorSubtotalMinor,
    includeShipping,
    subtotalMinor: amounts.subtotalMinor,
    taxMinor: amounts.taxMinor,
    shippingMinor: amounts.shippingMinor,
    totalMinor: amounts.totalMinor,
  }
}

/** A prepare refusal in `postEntry`'s vocabulary, so the dialog renders it like any other. */
function refusalOf(error: AuxxError): PostResult {
  if (error instanceof NothingToRecogniseError)
    return { status: 'nothing_to_recognise', error: error.message }
  return { status: 'error', failureClass: 'data', retryable: false, error: error.message }
}

/**
 * Build the entry this shipment would post, without writing anything.
 *
 * Runs the SAME core `fulfillOrder` runs, so what the dialog shows is what the
 * write would freeze (88 D6). A refusal comes back as `preview.blockedBy`, which
 * is what `EntryBlockers` renders.
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
      const shipment = shapeRequestedShipment(order, shippedLines, shippedAt)

      let prepared: PreparedFulfillmentEntry
      try {
        const window = await readShipmentPostingWindow(organizationId)
        prepared = await prepareShipmentEntry(db, { organizationId, order, shipment, window })
      } catch (error) {
        if (!(error instanceof AuxxError)) throw error
        const refusal = refusalOf(error)
        return {
          postingType: 'fulfillment' as const,
          periodKey: '',
          txnDate: shippedAt,
          docNumber: '',
          lines: [],
          totalMinor: 0,
          blockedBy: { status: refusal.status, error: refusal.error ?? error.message },
          order,
        }
      }
      const lock = await resolvePeriodLock(organizationId)
      const preview = await previewEntry(db, {
        organizationId,
        entry: prepared.entry,
        lock,
        scope: prepared.scope,
      })
      return { ...preview, order }
    },
    'Failed to preview a fulfillment',
    { organizationId, orderId }
  )
}

/**
 * Post one shipment's revenue: subject the fulfillment, parent the order,
 * counterparty the customer's contact (when the order has one) - the links and
 * the scope `prepareFulfillmentEntry` resolved, so the native door's posting
 * is byte-identical to the sweep's (88 D6). `railId` is always `null`: a
 * shipment debits `accounts_receivable`, never a gateway's clearing account (D11).
 *
 * Posts inside the fulfillment's own transaction, so the shipment and its entry
 * commit together. A REFUSAL is not a throw - nothing is written at that
 * point - so a closed month still retains the shipment.
 */
async function postFulfillmentEntryInTx(
  tx: Transaction,
  input: {
    organizationId: string
    prepared: PreparedFulfillmentEntry
    actorUserId: string
    memo?: string
  }
): Promise<InTxPostResult> {
  const { organizationId, prepared, actorUserId, memo } = input
  const lock = await resolvePeriodLock(organizationId, tx)
  return postEntryInTx(tx, {
    organizationId,
    entry: prepared.entry,
    lock,
    scope: prepared.scope,
    sources: prepared.sources,
    storeId: prepared.storeId,
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
          const shipment = shapeRequestedShipment(order, shippedLines, shippedAt)
          const shipped = shipment.lines
          const { sequence } = shipment
          const recordedAt = new Date().toISOString()
          const name = defaultFulfillmentName(order.number, sequence)
          const created = await createFulfillment(tx, {
            organizationId,
            actorUserId,
            orderInstanceId: orderId,
            sequence,
            shippedAt: shipment.shippedAt,
            status: 'success',
            name,
            subtotalMinor: shipment.subtotalMinor,
            totalMinor: shipment.totalMinor,
            shippingRecognised: shipment.shippingMinor > 0,
            recordedAt,
            lines: shipped.map((line) => ({
              lineItemInstanceId: line.lineId,
              quantity: line.quantity,
            })),
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

          // The entry commits with the shipment it recognises, built off the
          // record just written so the sweep could not have built it differently
          // (88 D6). A refusal is a result, and after commit a marker (§7.4);
          // the shipment stands either way.
          let post: InTxPostResult = { status: 'not_enabled' }
          let blocked: WorkItemRefusal | null = null
          if (accountingEnabled) {
            try {
              const prepared = await prepareFulfillmentEntry(tx, {
                organizationId,
                fulfillmentId: created.fulfillmentInstanceId,
              })
              post = await postFulfillmentEntryInTx(tx, {
                organizationId,
                prepared,
                actorUserId,
                memo,
              })
              if (!didLedgerAccept(post))
                blocked = refusalFromPost(post, {
                  periodKey: prepared.entry.txnDate.slice(0, 7),
                })
            } catch (error) {
              if (!(error instanceof AuxxError)) throw error
              post = refusalOf(error)
              if (!(error instanceof NothingToRecogniseError)) blocked = refusalFromError(error)
            }
          }
          const fulfillment: Fulfillment = {
            id: created.fulfillmentInstanceId,
            recordId: created.recordId,
            orderId,
            sequence,
            shippedAt: shipment.shippedAt,
            status: 'success',
            cancelledAt: null,
            name,
            trackingNumber: null,
            trackingCompany: null,
            trackingUrl: null,
            subtotalMinor: shipment.subtotalMinor,
            totalMinor: shipment.totalMinor,
            shippingRecognised: shipment.shippingMinor > 0,
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
            shippedAtInstant: shipment.shippedAt,
            post,
            blocked,
          }
        })
      )
      if (committed.owned) await flushTxWriteScope(committed.scope)
      const { fulfillment, fulfillmentStatus, created, shipped, shippedAtInstant, blocked } =
        committed.result

      if (blocked) await parkFulfillment(db, organizationId, created.fulfillmentInstanceId, blocked)

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

// packages/lib/src/accounting/sales/fulfillments/accounting.ts

/**
 * The shipment poster: one shipment's revenue, from whichever door wrote it.
 *
 * ```
 *   Dr customer_deposits      what the receipts already funded
 *   Dr accounts_receivable    the rest
 *       Cr revenue_product    this shipment's subtotal
 *       Cr sales_tax_payable  the tax not already collected on an advance
 *       Cr revenue_shipping   the order's shipping, ONCE
 * ```
 *
 * The split comes from the order's recognition timeline, the same reader the
 * receipt poster uses, so the two sides of one order cannot disagree about who
 * owns which cent. An order with no connected source has no timeline to read
 * (`readOrderMoneyCoverage` answers `sourceAvailable: false`) and posts the
 * invoice shape instead: `Dr A/R` in full (88 §4.6).
 *
 * Two entrances onto one core. {@link prepareFulfillmentEntry} reads a
 * `fulfillment` record (the sweep, the sync trigger, the native door after its
 * write); {@link prepareShipmentEntry} takes the shipment as the caller
 * computed it (the native door's preview, which has no record yet). Both build
 * the same entry from the same walk (88 D6).
 *
 * The frame is `money/post-movement.ts`'s, restated for a record rather than a
 * movement: the live claim, the draft, the enabled/finalized/cutoff gates, the
 * three link rows, the period lock, and a refusal that is a `blocked` result
 * rather than a throw.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import {
  buildFulfillmentEntry,
  type FulfillmentRecognitionAllocation,
  type FulfillmentRecognitionTaxComponent,
} from '../../ledger/builders/fulfillment'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { LEDGER_CURRENCY, postEntry } from '../../ledger/post/post-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { FINALIZED_SETUP_STATE } from '../../ledger/setup/setup-readiness'
import type { BuiltEntry, GlPostingSourceInput, RoleSourceScope } from '../../ledger/types'
import { readOrderMoneyCoverage, readOrderSourceScope } from '../../money/customer-money/reads'
import { readOrderRecognitionFactsInTx } from '../../money/customer-money/recognition-facts'
import {
  readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource,
} from '../../money/customer-money/recognition-source'
import {
  refusalFromError,
  refusalFromPost,
  type WorkItemRefusal,
  withWorkItemCode,
} from '../../work-items/refusal'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { type OrderForFulfillment, readOrderForFulfillment } from '../orders/reads'
import { isLiveFulfillment } from './client'
import { findLiveFulfillmentDraft } from './posting-reads'
import { readFulfillmentPostingSubject } from './reads'
import type { OrderShipment } from './shipment-lines'
import { resolveOrderShipments } from './shipment-lines'

const logger = createScopedLogger('fulfillment-accounting')

/** The `sourceKind` of a shipment's subject link, and of every candidate read. */
export const FULFILLMENT_SOURCE_KIND = 'fulfillment'

/** The id a not-yet-written shipment carries through the timeline and the preview. */
export const PREVIEW_SHIPMENT_ID = 'preview'

/**
 * A refusal that is not a defect: the shipment recognises nothing, so there is
 * no entry to build and no marker to leave.
 */
export class NothingToRecogniseError extends UnprocessableEntityError {}

export type FulfillmentPostingResult =
  | { status: 'accepted'; glPostingId: string }
  /** A draft is waiting for approval in the Outbox; nothing is in the books yet. */
  | { status: 'drafted'; glPostingId: string }
  | { status: 'blocked'; reason: string }
  | { status: 'skipped'; reason: string }

/** What `postEntry` needs, and what the native door (D6) posts in its own transaction. */
export interface PreparedFulfillmentEntry {
  entry: BuiltEntry
  sources: GlPostingSourceInput[]
  /** `{ store: id }`, `{ store: null }` for the manual bucket, `{}` when ambiguous. */
  scope: RoleSourceScope
  storeId: string | null
  contactInstanceId: string | null
}

/** The window every shipment posts inside: the book zone and the opening cutoff. */
export interface ShipmentPostingWindow {
  zone: string
  cutoff: string | null
}

/**
 * One shipment as the sequence walk sees it, whether or not its record exists
 * yet: {@link OrderShipment}'s share plus the identity the entry is keyed on.
 */
export type ShipmentToRecognise = Pick<
  OrderShipment,
  | 'lines'
  | 'priorSubtotalMinor'
  | 'includeShipping'
  | 'subtotalMinor'
  | 'taxMinor'
  | 'shippingMinor'
  | 'totalMinor'
> & {
  /** The fulfillment id, or {@link PREVIEW_SHIPMENT_ID} for one not written yet. */
  id: string
  sequence: number
  /** The instant the goods went out. */
  shippedAt: string
}

const workKey = (fulfillmentId: string) => ({
  sourceKind: FULFILLMENT_SOURCE_KIND,
  sourceId: fulfillmentId,
  stage: 'post' as const,
})

/**
 * Park a shipment's refusal as a work item, or clear it with `null`. On `db`: the
 * prepare transaction the refusal came from rolled back.
 */
export async function parkFulfillment(
  db: Database,
  organizationId: string,
  fulfillmentId: string,
  refusal: WorkItemRefusal | null
): Promise<void> {
  if (refusal) await upsertWorkItem(db, organizationId, { ...workKey(fulfillmentId), ...refusal })
  else await deleteWorkItem(db, organizationId, workKey(fulfillmentId))
}

/** A minor-unit string off the allocator, as the builder's integer. */
function safeMinor(value: string, label: string): number {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new UnprocessableEntityError(`${label} is not a whole minor-unit amount`)
  return amount
}

/** Read the window once per call. Throws until setup is finalized and a zone is set. */
export async function readShipmentPostingWindow(
  organizationId: string
): Promise<ShipmentPostingWindow> {
  const settings = await readOrganizationSettings(organizationId, [
    'accounting.setupState',
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE)
    throw new UnprocessableEntityError(
      'Finalize accounting setup before posting shipments',
      withWorkItemCode('SETUP_INCOMPLETE')
    )
  const zone = settings['accounting.bookTimeZone']
  if (!zone)
    throw new UnprocessableEntityError(
      'Book time zone is not configured',
      withWorkItemCode('SETUP_INCOMPLETE')
    )
  return { zone, cutoff: settings['accounting.cutoffPeriod'] ?? null }
}

/**
 * Build the entry one shipment would post, from the shipment as the walk
 * computed it, inside the caller's transaction.
 *
 * Throws an `AuxxError` on every refusal - a {@link NothingToRecogniseError}
 * when the shipment is worth nothing, and the timeline's or the builder's own
 * words otherwise.
 */
export async function prepareShipmentEntry(
  tx: Database | Transaction,
  input: {
    organizationId: string
    order: OrderForFulfillment
    shipment: ShipmentToRecognise
    window: ShipmentPostingWindow
  }
): Promise<PreparedFulfillmentEntry> {
  const { organizationId, order, shipment, window } = input
  if (shipment.totalMinor === 0)
    throw new NothingToRecogniseError('Shipment is worth nothing, so there is nothing to recognise')

  const occurredAt = new Date(shipment.shippedAt)
  if (!Number.isFinite(occurredAt.getTime()))
    throw new UnprocessableEntityError(
      'Shipment has no shipped date to post against',
      withWorkItemCode('MISSING_DATE')
    )
  const txnDate = periodKeyForDate(occurredAt, 'day', window.zone)
  if (window.cutoff && txnDate.slice(0, 7) <= window.cutoff)
    throw new UnprocessableEntityError(
      `Shipment is before the accounting opening cutoff ${window.cutoff}`,
      withWorkItemCode('BEFORE_CUTOFF')
    )

  const facts = await readOrderRecognitionFactsInTx(tx, organizationId, order.orderId)
  // An order with no connected source has no timeline to replay: the reader
  // answers `complete: false` over zero coverage rows, which would refuse every
  // hand-recorded shipment. It posts the invoice shape instead - Dr A/R in full
  // - which is what the deleted batch poster did (88 §4.6, `reads.ts:184`).
  const coverage = await readOrderMoneyCoverage(tx, organizationId, order.orderId)
  let recognitionAllocation: FulfillmentRecognitionAllocation | undefined
  let recognitionTaxComponents: FulfillmentRecognitionTaxComponent[] | undefined
  if (coverage.sourceAvailable) {
    const timeline = requireCompleteOrderRecognitionSource(
      await readOrderRecognitionSource(tx, {
        organizationId,
        orderId: order.orderId,
        orderNetMinor: (facts.subtotal + facts.shipping).toString(),
        orderTaxMinor: facts.tax.toString(),
        bookTimeZone: window.zone,
        target: { kind: 'fulfillment', id: shipment.id },
        // Only read when no record carries this shipment yet (the preview).
        targetEvent: {
          id: shipment.id,
          kind: 'fulfillment',
          effectiveDate: txnDate,
          occurredAt: occurredAt.toISOString(),
          netMinor: String(shipment.subtotalMinor + shipment.shippingMinor),
          taxMinor: String(shipment.taxMinor),
        },
      })
    )
    const target = timeline.target
    if (!target)
      throw new UnprocessableEntityError('Shipment is absent from the recognition timeline')
    recognitionAllocation = {
      amountMinor: safeMinor(target.amountMinor, 'Shipment recognition amount'),
      depositMinor: safeMinor(target.depositMinor, 'Shipment deposit release'),
      receivableMinor: safeMinor(target.receivableMinor, 'Shipment receivable'),
      taxMinor: safeMinor(target.taxMinor, 'Shipment recognised tax'),
      historyHash: target.historyHash,
    }
    recognitionTaxComponents = (timeline.targetTaxComponents ?? []).map((component) => ({
      ...component,
      amountMinor: safeMinor(component.amountMinor, 'Shipment tax component'),
    }))
  }

  const built = buildFulfillmentEntry({
    orderId: order.orderId,
    orderNumber: order.number ?? '',
    sequence: shipment.sequence,
    channel: order.channel,
    currency: order.currency,
    ledgerCurrency: LEDGER_CURRENCY,
    txnDate,
    shippedLines: shipment.lines,
    orderSubtotalMinor: order.subtotalMinor,
    orderTaxTotalMinor: order.taxTotalMinor,
    orderShippingTotalMinor: order.shippingTotalMinor,
    priorShipmentsSubtotalMinor: shipment.priorSubtotalMinor,
    includeShipping: shipment.includeShipping,
    contactInstanceId: order.contactInstanceId,
    taxLines: order.taxLines,
    ...(recognitionAllocation ? { recognitionAllocation } : {}),
    ...(recognitionTaxComponents?.length ? { recognitionTaxComponents } : {}),
  })

  const scope = await readOrderSourceScope(tx, organizationId, order.orderId)
  const sources: GlPostingSourceInput[] = [
    { sourceKind: FULFILLMENT_SOURCE_KIND, sourceId: shipment.id, linkRole: 'subject' },
    { sourceKind: 'order', sourceId: order.orderId, linkRole: 'parent' },
    ...(order.contactInstanceId
      ? [
          {
            sourceKind: 'contact',
            sourceId: order.contactInstanceId,
            linkRole: 'counterparty' as const,
          },
        ]
      : []),
  ]
  return {
    entry: built.entry,
    sources,
    scope,
    // D11: a shipment debits A/R or deposits, never a gateway's clearing
    // account, so there is no rail to scope it to.
    storeId: typeof scope.store === 'string' ? scope.store : null,
    contactInstanceId: order.contactInstanceId,
  }
}

/**
 * Build the entry one `fulfillment` record would post, inside the caller's
 * transaction.
 *
 * Throws an `AuxxError` on every refusal - a {@link NothingToRecogniseError}
 * when the shipment is cancelled or worth nothing, and the timeline's or the
 * builder's own words otherwise. {@link postFulfillmentAccounting} turns those
 * into a status; the native door (D6) posts the result in the transaction that
 * created the shipment.
 */
export async function prepareFulfillmentEntry(
  tx: Database | Transaction,
  input: { organizationId: string; fulfillmentId: string }
): Promise<PreparedFulfillmentEntry> {
  const { organizationId, fulfillmentId } = input
  const window = await readShipmentPostingWindow(organizationId)

  const subject = await readFulfillmentPostingSubject(tx, { organizationId, fulfillmentId })
  if (!subject) throw new NotFoundError('That shipment does not exist, or names no order')
  const read = await readOrderForFulfillment(tx, {
    organizationId,
    orderId: subject.orderId,
  })
  if (read.isErr()) throw read.error
  const order = read.value
  const shipment = resolveOrderShipments(order).find((row) => row.fulfillment.id === fulfillmentId)
  if (!shipment) throw new NotFoundError('That shipment is not on its own order')
  const { fulfillment } = shipment

  if (!isLiveFulfillment(fulfillment))
    throw new NothingToRecogniseError('Shipment is cancelled, so there is nothing to recognise')
  if (subject.subtotalMinor === null)
    throw new UnprocessableEntityError(
      'Shipment totals are not stamped yet',
      withWorkItemCode('TOTALS_NOT_STAMPED')
    )
  if (fulfillment.totalMinor === 0)
    throw new NothingToRecogniseError('Shipment is worth nothing, so there is nothing to recognise')
  if (!fulfillment.shippedAt)
    throw new UnprocessableEntityError(
      'Shipment has no shipped date to post against',
      withWorkItemCode('MISSING_DATE')
    )

  return prepareShipmentEntry(tx, {
    organizationId,
    order,
    window,
    shipment: {
      ...shipment,
      id: fulfillment.id,
      sequence: fulfillment.sequence,
      shippedAt: fulfillment.shippedAt,
    },
  })
}

/**
 * Post one shipment's revenue.
 *
 * **Never throws an `AuxxError`.** Every refusal comes back `blocked` and parks a
 * work item ({@link parkFulfillment}), because the goods have already left the
 * building and the caller records that either way.
 */
export async function postFulfillmentAccounting(
  db: Database,
  input: { organizationId: string; fulfillmentId: string; actorUserId?: string }
): Promise<FulfillmentPostingResult> {
  const { organizationId, fulfillmentId, actorUserId } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: FULFILLMENT_SOURCE_KIND,
    sourceId: fulfillmentId,
  })
  // A failed read of the posting index says nothing about the shipment, so it is
  // the one blocked answer that does not mark it.
  if (live.isErr()) return { status: 'blocked', reason: live.error.message }
  if (live.value) {
    await parkFulfillment(db, organizationId, fulfillmentId, null)
    return { status: 'accepted', glPostingId: live.value.id }
  }
  // A draft holds no subject claim, so the read above cannot see it.
  const draft = await findLiveFulfillmentDraft(db, organizationId, fulfillmentId)
  if (draft) return { status: 'drafted', glPostingId: draft }

  if (!(await isAccountingEnabled(db, organizationId)))
    return { status: 'skipped', reason: 'Accounting is not enabled' }

  let prepared: PreparedFulfillmentEntry
  try {
    prepared = await db.transaction((tx) =>
      prepareFulfillmentEntry(tx, { organizationId, fulfillmentId })
    )
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    if (error instanceof NothingToRecogniseError) {
      // A visible skip the sweep never re-offers, not a refusal.
      await parkFulfillment(db, organizationId, fulfillmentId, {
        reasonCode: 'NOTHING_TO_RECOGNISE',
      })
      return { status: 'skipped', reason: error.message }
    }
    logger.warn('A shipment could not be prepared', {
      organizationId,
      fulfillmentId,
      error: error.message,
    })
    await parkFulfillment(db, organizationId, fulfillmentId, refusalFromError(error))
    return { status: 'blocked', reason: error.message }
  }

  const lock = await resolvePeriodLock(organizationId)
  const post = await postEntry(db, {
    organizationId,
    entry: prepared.entry,
    actorUserId,
    lock,
    scope: prepared.scope,
    sources: prepared.sources,
    storeId: prepared.storeId,
    railId: null,
    mode: await readAutoPostMode(organizationId, 'fulfillment'),
  })
  if (post.status === 'drafted' && post.glPostingId) {
    // A draft is not a refusal; its own `pending` link stops the sweep drafting it again.
    await parkFulfillment(db, organizationId, fulfillmentId, null)
    return { status: 'drafted', glPostingId: post.glPostingId }
  }
  if (!didLedgerAccept(post) || !post.glPostingId) {
    const reason = post.error ?? `The ledger answered ${post.status}`
    await parkFulfillment(
      db,
      organizationId,
      fulfillmentId,
      refusalFromPost(post, { periodKey: prepared.entry.txnDate.slice(0, 7) })
    )
    return { status: 'blocked', reason }
  }
  await parkFulfillment(db, organizationId, fulfillmentId, null)
  return { status: 'accepted', glPostingId: post.glPostingId }
}

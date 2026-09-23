// packages/lib/src/accounting/sales/fulfillments/accounting.ts

/**
 * The shipment poster: `Dr accounts_receivable / Cr revenue, Cr shipping, Cr sales tax`
 * off the shipment's own stamped totals, never a sibling's posting (91 D2).
 * {@link prepareFulfillmentEntry} reads a `fulfillment` record; {@link prepareShipmentEntry}
 * takes the native door's not-yet-written shipment. No permission checks here.
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { buildFulfillmentEntry } from '../../ledger/builders/fulfillment'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { LEDGER_CURRENCY, postEntry } from '../../ledger/post/post-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { FINALIZED_SETUP_STATE } from '../../ledger/setup/setup-readiness'
import type { BuiltEntry, GlPostingSourceInput, RoleSourceScope } from '../../ledger/types'
import { readOrderSourceScope } from '../../money/customer-money/reads'
import {
  refusalFromError,
  refusalFromPost,
  type WorkItemRefusal,
  withWorkItemCode,
} from '../../work-items/refusal'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { type OrderForFulfillment, readOrderForFulfillment } from '../orders/reads'
import { isLiveFulfillment } from './client'
import { readFulfillmentPostingSubject } from './reads'
import type { OrderShipment } from './shipment-lines'
import { resolveOrderShipments } from './shipment-lines'

const logger = createScopedLogger('fulfillment-accounting')

/** The `sourceKind` of a shipment's subject link, and of every candidate read. */
export const FULFILLMENT_SOURCE_KIND = 'fulfillment'

/**
 * A refusal that is not a defect: the shipment recognises nothing, so there is
 * no entry to build and no marker to leave.
 */
export class NothingToRecogniseError extends UnprocessableEntityError {}

export type FulfillmentPostingResult =
  | { status: 'accepted'; glPostingId: string }
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

/** One shipment as the sequence walk sees it, whether or not its record exists yet. */
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
  /** The fulfillment id, or a placeholder for the native door's preview. */
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
 * Build the entry one shipment would post, inside the caller's transaction. Throws an
 * `AuxxError` on every refusal ({@link NothingToRecogniseError} when it is worth nothing).
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
    // D11: a shipment debits the store's A/R, never a gateway's clearing account, so no rail.
    storeId: typeof scope.store === 'string' ? scope.store : null,
    contactInstanceId: order.contactInstanceId,
  }
}

/**
 * Build the entry one `fulfillment` record would post, inside the caller's transaction.
 * Throws like {@link prepareShipmentEntry}; {@link postFulfillmentAccounting} turns that into a status.
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
    occurrence: 'original',
  })
  // A failed read of the posting index says nothing about the shipment, so it is
  // the one blocked answer that does not mark it.
  if (live.isErr()) return { status: 'blocked', reason: live.error.message }
  if (live.value) {
    await parkFulfillment(db, organizationId, fulfillmentId, null)
    return { status: 'accepted', glPostingId: live.value.id }
  }

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
  })
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

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
 * The frame is `money/post-movement.ts`'s, restated for a record rather than a
 * movement: the live claim, the draft, the enabled/finalized/cutoff gates, the
 * three link rows, the period lock, and a refusal that is a `blocked` result
 * rather than a throw.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { requireCachedEntityDefId } from '../../../cache'
import { AuxxError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { toFieldType } from '../../../field-values/stored-field-type'
import { toRecordId } from '../../../resources/resource-id'
import { systemFieldMap } from '../../../resources/system-records'
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
import { readOrderForFulfillment } from '../orders/reads'
import { isLiveFulfillment } from './client'
import { findLiveFulfillmentDraft } from './posting-reads'
import { readFulfillmentPostingSubject } from './reads'
import { resolveOrderShipments } from './shipment-lines'

const logger = createScopedLogger('fulfillment-accounting')

/** The `sourceKind` of a shipment's subject link, and of every candidate read. */
export const FULFILLMENT_SOURCE_KIND = 'fulfillment'

/** The two fields 88 §7.4 puts the poster's last refusal on. */
const MARKER_ATTRS = [
  'fulfillment_posting_blocked_reason',
  'fulfillment_posting_blocked_at',
] as const

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

/**
 * Record why the ledger refused, or clear the mark once it accepts.
 *
 * ⚠️ On `db`, never the prepare transaction: a refusal rolls that back, and a
 * mark rolled back with it is a mark the sweep never sees. No `userId` on the
 * context either - the hook chain must not re-enter the totals reconciler.
 */
async function markPostingBlock(
  db: Database,
  organizationId: string,
  fulfillmentId: string,
  reason: string | null
): Promise<void> {
  const fields = await systemFieldMap<SystemAttribute>(db, organizationId, [...MARKER_ATTRS])
  const reasonField = fields.fulfillment_posting_blocked_reason
  const atField = fields.fulfillment_posting_blocked_at
  // An org that has not run migration 184 has nowhere to record this; the
  // refusal is still the caller's answer.
  if (!reasonField || !atField) return
  const defId = await requireCachedEntityDefId(organizationId, 'fulfillment')
  const recordId = toRecordId(defId, fulfillmentId)
  const context = createFieldValueContext(organizationId, undefined, db)
  await setValueWithType(context, {
    recordId,
    fieldId: reasonField.id,
    fieldType: toFieldType(reasonField.type),
    value: reason === null ? null : { type: 'text', value: reason },
  })
  await setValueWithType(context, {
    recordId,
    fieldId: atField.id,
    fieldType: toFieldType(atField.type),
    value: reason === null ? null : { type: 'date', value: new Date().toISOString() },
  })
}

/** A minor-unit string off the allocator, as the builder's integer. */
function safeMinor(value: string, label: string): number {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new UnprocessableEntityError(`${label} is not a whole minor-unit amount`)
  return amount
}

/**
 * Build the entry one shipment would post, inside the caller's transaction.
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
  const settings = await readOrganizationSettings(organizationId, [
    'accounting.setupState',
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE)
    throw new UnprocessableEntityError('Finalize accounting setup before posting shipments')
  const zone = settings['accounting.bookTimeZone']
  if (!zone) throw new UnprocessableEntityError('Book time zone is not configured')

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
    throw new UnprocessableEntityError('Shipment totals are not stamped yet')
  if (fulfillment.totalMinor === 0)
    throw new NothingToRecogniseError('Shipment is worth nothing, so there is nothing to recognise')
  if (!fulfillment.shippedAt)
    throw new UnprocessableEntityError('Shipment has no shipped date to post against')

  const txnDate = periodKeyForDate(new Date(fulfillment.shippedAt), 'day', zone)
  const cutoff = settings['accounting.cutoffPeriod']
  if (cutoff && txnDate.slice(0, 7) <= cutoff)
    throw new UnprocessableEntityError(`Shipment is before the accounting opening cutoff ${cutoff}`)

  const facts = await readOrderRecognitionFactsInTx(tx, organizationId, subject.orderId)
  // An order with no connected source has no timeline to replay: the reader
  // answers `complete: false` over zero coverage rows, which would refuse every
  // hand-recorded shipment. It posts the invoice shape instead - Dr A/R in full
  // - which is what the deleted batch poster did (88 §4.6, `reads.ts:184`).
  const coverage = await readOrderMoneyCoverage(tx, organizationId, subject.orderId)
  let recognitionAllocation: FulfillmentRecognitionAllocation | undefined
  let recognitionTaxComponents: FulfillmentRecognitionTaxComponent[] | undefined
  if (coverage.sourceAvailable) {
    const timeline = requireCompleteOrderRecognitionSource(
      await readOrderRecognitionSource(tx, {
        organizationId,
        orderId: subject.orderId,
        orderNetMinor: (facts.subtotal + facts.shipping).toString(),
        orderTaxMinor: facts.tax.toString(),
        bookTimeZone: zone,
        target: { kind: 'fulfillment', id: fulfillmentId },
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
    orderId: subject.orderId,
    orderNumber: order.number ?? '',
    sequence: fulfillment.sequence,
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

  const scope = await readOrderSourceScope(tx, organizationId, subject.orderId)
  const sources: GlPostingSourceInput[] = [
    { sourceKind: FULFILLMENT_SOURCE_KIND, sourceId: fulfillmentId, linkRole: 'subject' },
    { sourceKind: 'order', sourceId: subject.orderId, linkRole: 'parent' },
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
 * Post one shipment's revenue.
 *
 * **Never throws an `AuxxError`.** Every refusal comes back `blocked` with the
 * poster's own words on {@link markPostingBlock}'s two fields, because the goods
 * have already left the building and the caller records that either way.
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
    await markPostingBlock(db, organizationId, fulfillmentId, null)
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
      await markPostingBlock(db, organizationId, fulfillmentId, null)
      return { status: 'skipped', reason: error.message }
    }
    logger.warn('A shipment could not be prepared', {
      organizationId,
      fulfillmentId,
      error: error.message,
    })
    await markPostingBlock(db, organizationId, fulfillmentId, error.message)
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
    // A draft is not a refusal, so the block clears; the draft's own `pending`
    // link is what stops the sweep drafting it again.
    await markPostingBlock(db, organizationId, fulfillmentId, null)
    return { status: 'drafted', glPostingId: post.glPostingId }
  }
  if (!didLedgerAccept(post) || !post.glPostingId) {
    const reason = post.error ?? `The ledger answered ${post.status}`
    await markPostingBlock(db, organizationId, fulfillmentId, reason)
    return { status: 'blocked', reason }
  }
  await markPostingBlock(db, organizationId, fulfillmentId, null)
  return { status: 'accepted', glPostingId: post.glPostingId }
}

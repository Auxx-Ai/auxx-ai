// packages/lib/src/accounting/money/customer-money/recognition-source.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { readFulfillmentsForOrder } from '../../sales/fulfillments/reads'
import { readOrderMoneyCoverage } from './reads'
import {
  allocateOrderRecognition,
  allocateRecognitionTaxComponents,
  type OrderRecognitionAllocation,
  type OrderRecognitionEvent,
} from './recognition'
import { readOrderRecognitionFactsInTx } from './recognition-facts'

type Db = Database | Transaction

/** Facts needed to replay one order's receipt and shipment timeline. */
export interface OrderRecognitionSource {
  organizationId: string
  orderId: string
  orderNetMinor: string
  orderTaxMinor: string
  events: OrderRecognitionEvent[]
  allocations: OrderRecognitionAllocation[]
  target: OrderRecognitionAllocation | null
  targetTaxComponents:
    | {
        componentKey: string
        amountMinor: string
        jurisdiction: string | null
        collector: 'merchant' | 'marketplace'
        remitter: 'merchant' | 'marketplace'
        withholdingEvidenceId: string | null
      }[]
    | null
  blockers: string[]
  sourceStoreId: string | null
  coverage: { complete: boolean; fetched: number; accepted: number; pending: number }
}

/** Normalize a stored PostgreSQL or ISO timestamp without inventing a time for a date. */
export function sourceOccurrence(raw: unknown, label: string): string {
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(raw)
  )
    throw new UnprocessableEntityError(`${label} has no source occurrence instant`)
  const value = new Date(raw.replace(/([+-]\d{2})$/, '$1:00'))
  if (!Number.isFinite(value.getTime()))
    throw new UnprocessableEntityError(`${label} occurrence instant is invalid`)
  return value.toISOString()
}

function eventPrecedes(left: OrderRecognitionEvent, right: OrderRecognitionEvent): boolean {
  const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
  if (time !== 0) return time < 0
  if (left.kind !== right.kind) return left.kind === 'receipt'
  return left.id.localeCompare(right.id) < 0
}

/** Read actual receipts and recorded shipments, including a current target event. */
export async function readOrderRecognitionSource(
  db: Db,
  input: {
    organizationId: string
    orderId: string
    orderNetMinor: string
    orderTaxMinor: string
    bookTimeZone: string
    target?: { kind: 'receipt' | 'fulfillment'; id: string }
    /** Current unaccepted event supplied by the fulfillment source reader. */
    targetEvent?: OrderRecognitionEvent
  }
): Promise<OrderRecognitionSource> {
  const blockers: string[] = []
  // A credit memo posted against this order changes what its revenue timeline
  // means, and this reader cannot express that. Found through the memo posting's
  // `parent` link, never a stamp (TARGET §1).
  const [credit] = await db
    .select({ id: schema.GlPostingSource.id })
    .from(schema.GlPostingSource)
    .innerJoin(
      schema.GlPosting,
      and(
        eq(schema.GlPosting.organizationId, schema.GlPostingSource.organizationId),
        eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId),
        eq(schema.GlPosting.postingType, 'credit_memo')
      )
    )
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, input.organizationId),
        eq(schema.GlPostingSource.sourceKind, 'order'),
        eq(schema.GlPostingSource.sourceId, input.orderId),
        eq(schema.GlPostingSource.linkRole, 'parent')
      )
    )
    .limit(1)
  if (credit)
    blockers.push(
      'Order recognition must include its posted credit components before further posting'
    )
  let recognitionFacts: Awaited<ReturnType<typeof readOrderRecognitionFactsInTx>> | null = null
  try {
    recognitionFacts = await readOrderRecognitionFactsInTx(db, input.organizationId, input.orderId)
    if (
      recognitionFacts.subtotal + recognitionFacts.shipping !== BigInt(input.orderNetMinor) ||
      recognitionFacts.tax !== BigInt(input.orderTaxMinor)
    )
      blockers.push('Canonical order facts differ from the recognition source input')
  } catch (error) {
    if (!(error instanceof UnprocessableEntityError)) throw error
    blockers.push(error.message)
  }
  const [coverage, accepted] = await Promise.all([
    readOrderMoneyCoverage(db, input.organizationId, input.orderId),
    db.query.FinancialSourceAcceptance.findMany({
      where: and(
        eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
        eq(schema.FinancialSourceAcceptance.orderInstanceId, input.orderId)
      ),
      columns: { orderExternalId: true, sourceObjectId: true, state: true },
    }),
  ])
  const sourceObjects = accepted.length
    ? await db.query.FinancialSourceObject.findMany({
        where: and(
          eq(schema.FinancialSourceObject.organizationId, input.organizationId),
          inArray(schema.FinancialSourceObject.id, [
            ...new Set(accepted.map((row) => row.sourceObjectId)),
          ])
        ),
        columns: { id: true, sourceAccountId: true },
      })
    : []
  const sourceAccountIds = [...new Set(sourceObjects.map((row) => row.sourceAccountId))]
  const sourceAccounts = sourceAccountIds.length
    ? await db.query.FinancialSourceAccount.findMany({
        where: and(
          eq(schema.FinancialSourceAccount.organizationId, input.organizationId),
          inArray(schema.FinancialSourceAccount.id, sourceAccountIds)
        ),
        columns: { id: true, environment: true, archivedAt: true, providerKey: true },
      })
    : []
  if (
    sourceAccountIds.length !== sourceAccounts.length ||
    sourceAccounts.some(
      (account) =>
        account.environment !== 'live' ||
        account.archivedAt !== null ||
        !coverage.sourceStoreIds.includes(account.id)
    )
  )
    blockers.push('Source transaction evidence is not from one live source account')
  const sourceStoreIds = [...new Set(sourceObjects.map((row) => row.sourceAccountId))]
  if (sourceStoreIds.length > 1)
    blockers.push('Source transaction evidence spans multiple source stores')
  if (!coverage.complete) blockers.push('Source transaction coverage is incomplete or unresolved')
  if (coverage.sourceStoreIds.length > 1)
    blockers.push('Source transaction evidence spans multiple source stores')
  if (
    accepted.some(
      (row) => row.state === 'pending' || row.state === 'blocked' || row.state === 'rejected'
    )
  )
    blockers.push('Source transaction evidence is pending, blocked, or rejected')

  const allApplications = await db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, input.organizationId),
      eq(schema.MoneyApplication.orderInstanceId, input.orderId)
    ),
    orderBy: asc(schema.MoneyApplication.createdAt),
  })
  const applications = allApplications.filter((row) => row.operation === 'apply')
  if (allApplications.some((row) => row.operation === 'unapply'))
    blockers.push('Receipt timeline contains an unapplied money application')
  const moneyIds = [...new Set(applications.map((row) => row.moneyTransactionId))]
  const moneyRows = moneyIds.length
    ? await db.query.MoneyTransaction.findMany({
        where: and(
          eq(schema.MoneyTransaction.organizationId, input.organizationId),
          inArray(schema.MoneyTransaction.id, moneyIds),
          eq(schema.MoneyTransaction.purpose, 'customer_receipt')
        ),
      })
    : []
  if (moneyIds.length) {
    const refunds = await db.query.MoneyRefundSettlement.findMany({
      where: and(
        eq(schema.MoneyRefundSettlement.organizationId, input.organizationId),
        inArray(schema.MoneyRefundSettlement.originalTransactionId, moneyIds)
      ),
      columns: { originalTransactionId: true },
    })
    for (const refund of refunds)
      blockers.push(`receipt ${refund.originalTransactionId} has a refund settlement`)
  }
  const moneyById = new Map(moneyRows.map((row) => [row.id, row]))
  const events: OrderRecognitionEvent[] = []
  for (const application of applications) {
    const money = moneyById.get(application.moneyTransactionId)
    if (!money) {
      blockers.push(`missing receipt ${application.moneyTransactionId}`)
      continue
    }
    if (money.currency !== 'USD' || money.currencyExponent !== 2)
      blockers.push(`receipt ${money.id} is outside the supported USD ledger`)
    if (!money.occurredAt) {
      blockers.push(`receipt ${money.id} has no occurrence instant`)
      continue
    }
    if (application.effectiveDate !== periodKeyForDate(money.occurredAt, 'day', input.bookTimeZone))
      blockers.push(`receipt ${money.id} application date differs from its book date`)
    if (application.amountMinor !== money.amountMinor)
      blockers.push(`receipt ${money.id} is partially applied and needs split effect ownership`)
    events.push({
      id: money.id,
      kind: 'receipt',
      effectiveDate: application.effectiveDate,
      occurredAt: money.occurredAt.toISOString(),
      amountMinor: application.amountMinor.toString(),
    })
  }

  // ── The shipment half, off the fulfillment RECORDS ──────────────────────
  // Net and tax are recovered from the stamped shipment totals rather than
  // from a frozen accounting basis: `fulfillment_total` is subtotal + tax +
  // shipping, and `fulfillment_shipping_recognised` says whether the order's
  // shipping was taken on this shipment.
  const orderShippingMinor = recognitionFacts?.shipping ?? 0n
  const fulfillments = await readFulfillmentsForOrder(db, {
    organizationId: input.organizationId,
    orderId: input.orderId,
  })
  if (fulfillments.some((row) => row.status === 'cancelled'))
    blockers.push('Canceled shipment evidence requires explicit cancellation accounting')

  const shipmentEvents: { event: OrderRecognitionEvent; posted: boolean }[] = []
  for (const fulfillment of fulfillments) {
    if (fulfillment.status === 'cancelled') continue
    if (!fulfillment.shippedAt) {
      blockers.push(`fulfillment ${fulfillment.id} has no source shipment occurrence instant`)
      continue
    }
    let occurredAt: string
    try {
      occurredAt = sourceOccurrence(fulfillment.shippedAt, `fulfillment ${fulfillment.id}`)
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
      continue
    }
    const shippingMinor = fulfillment.shippingRecognised ? orderShippingMinor : 0n
    const netMinor = BigInt(fulfillment.subtotalMinor) + shippingMinor
    const taxMinor =
      BigInt(fulfillment.totalMinor) - BigInt(fulfillment.subtotalMinor) - shippingMinor
    if (netMinor < 0n || taxMinor < 0n) {
      blockers.push(`fulfillment ${fulfillment.id} has inconsistent shipment totals`)
      continue
    }
    shipmentEvents.push({
      event: {
        id: fulfillment.id,
        kind: 'fulfillment',
        effectiveDate: periodKeyForDate(new Date(occurredAt), 'day', input.bookTimeZone),
        occurredAt,
        netMinor: netMinor.toString(),
        taxMinor: taxMinor.toString(),
      },
      posted: fulfillment.glPosting !== null,
    })
  }
  for (const shipment of shipmentEvents) events.push(shipment.event)

  const targetTimelineEvent = input.target
    ? ((input.targetEvent &&
      input.target.kind === 'fulfillment' &&
      input.targetEvent.kind === 'fulfillment' &&
      input.targetEvent.id === input.target.id
        ? shipmentEvents.find((row) => row.event.id === input.target!.id)?.event
        : undefined) ??
      events.find((event) => event.kind === input.target!.kind && event.id === input.target!.id))
    : undefined

  // An earlier shipment that has not posted leaves this one recognising
  // revenue out of order, so the timeline refuses until it lands.
  if (targetTimelineEvent)
    for (const shipment of shipmentEvents) {
      if (shipment.event.id === input.target?.id || shipment.posted) continue
      if (eventPrecedes(shipment.event, targetTimelineEvent))
        blockers.push(`earlier shipment accounting pending for fulfillment ${shipment.event.id}`)
    }

  let allocations: OrderRecognitionAllocation[] = []
  if (blockers.length === 0) {
    try {
      allocations = allocateOrderRecognition({
        orderNetMinor: input.orderNetMinor,
        orderTaxMinor: input.orderTaxMinor,
        events,
      })
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
    }
  }
  // An earlier receipt that has not posted would make this one recognise out
  // of order, exactly as an unposted earlier shipment does.
  if (allocations.length && moneyIds.length && targetTimelineEvent) {
    const postedReceipts = await db
      .select({ sourceId: schema.GlPostingSource.sourceId })
      .from(schema.GlPostingSource)
      .where(
        and(
          eq(schema.GlPostingSource.organizationId, input.organizationId),
          eq(schema.GlPostingSource.sourceKind, 'money_transaction'),
          inArray(schema.GlPostingSource.sourceId, moneyIds),
          eq(schema.GlPostingSource.linkRole, 'subject')
        )
      )
    const posted = new Set(postedReceipts.map((row) => row.sourceId))
    for (const event of events) {
      if (event.kind !== 'receipt' || event.id === input.target?.id) continue
      if (eventPrecedes(event, targetTimelineEvent) && !posted.has(event.id))
        blockers.push(`earlier receipt accounting pending for receipt ${event.id}`)
    }
  }
  const target = input.target
    ? (allocations.find((row) => row.kind === input.target!.kind && row.id === input.target!.id) ??
      null)
    : null
  const componentAllocations =
    allocations.length && recognitionFacts && !blockers.length
      ? allocateRecognitionTaxComponents(allocations, recognitionFacts.taxComponents)
      : new Map<string, { componentKey: string; amountMinor: string }[]>()
  const factsComponents = new Map(
    recognitionFacts?.taxComponents.map((component) => [component.componentKey, component]) ?? []
  )
  const targetTaxComponents = input.target
    ? (componentAllocations.get(input.target.id)?.map((component) => ({
        ...component,
        jurisdiction: factsComponents.get(component.componentKey)?.jurisdiction ?? null,
        collector: factsComponents.get(component.componentKey)?.collector ?? 'merchant',
        remitter: factsComponents.get(component.componentKey)?.remitter ?? 'merchant',
        withholdingEvidenceId:
          factsComponents.get(component.componentKey)?.withholdingEvidenceId ?? null,
      })) ?? null)
    : null
  if (input.target && !target && blockers.length === 0)
    blockers.push(
      `target ${input.target.kind} ${input.target.id} is absent from the recognition timeline`
    )
  return {
    organizationId: input.organizationId,
    orderId: input.orderId,
    orderNetMinor: input.orderNetMinor,
    orderTaxMinor: input.orderTaxMinor,
    events,
    allocations,
    target,
    targetTaxComponents,
    blockers: [...new Set(blockers)],
    sourceStoreId:
      sourceStoreIds.length === 1
        ? sourceStoreIds[0]!
        : coverage.sourceStoreIds.length === 1
          ? coverage.sourceStoreIds[0]!
          : null,
    coverage: {
      complete: coverage.complete,
      fetched: coverage.fetched,
      accepted: coverage.accepted,
      pending: coverage.pending,
    },
  }
}

/** Refuse a timeline before using any event allocation as authoritative. */
export function requireCompleteOrderRecognitionSource(source: OrderRecognitionSource) {
  if (source.blockers.length)
    throw new UnprocessableEntityError(
      `Order recognition timeline is incomplete: ${source.blockers.join('; ')}`
    )
  return source
}

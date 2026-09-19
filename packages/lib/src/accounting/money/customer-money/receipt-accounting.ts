// packages/lib/src/accounting/money/customer-money/receipt-accounting.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../../errors'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { periodKeyForDate } from '../../ledger/periods/periods'
import type { PaymentGatewayRow } from '../../rails/client'
import {
  type GatewayRoute,
  matchGatewayRoute,
  normaliseGatewayHandle,
  RESERVED_GATEWAY_HANDLES,
  toGatewayRoutes,
} from '../../rails/client'
import { getPaymentGateway, listPaymentGateways } from '../../rails/reads'
import { confirmedCustomerMovement } from './contracts'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'

/** Read the canonical movement and its accepted source evidence under the commit lock. */
export async function readCustomerReceiptAccountingSource(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string,
  bookTimeZone: string
) {
  const money = await tx.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.id, moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_receipt')
    ),
  })
  if (!money || money.currency !== 'USD' || money.currencyExponent !== 2 || !money.occurredAt)
    throw new UnprocessableEntityError(
      'Receipt requires a confirmed USD amount and occurrence instant'
    )
  const nativeOwnership = await tx.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, organizationId),
      eq(schema.MoneyCommand.kind, 'adopt_native_stripe_evidence'),
      sql`${schema.MoneyCommand.resultIds}->>'moneyTransactionId' = ${money.id}`
    ),
  })
  if (nativeOwnership)
    throw new UnprocessableEntityError(
      'Receipt is linked to native payment accounting; repair its existing accounting membership before switching ownership'
    )
  const effectiveDate = periodKeyForDate(money.occurredAt, 'day', bookTimeZone)
  const applications = await tx.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, organizationId),
      eq(schema.MoneyApplication.moneyTransactionId, moneyTransactionId)
    ),
    orderBy: asc(schema.MoneyApplication.id),
  })
  const orderId = applications[0]?.orderInstanceId
  if (
    !orderId ||
    applications.some(
      (a) =>
        a.operation !== 'apply' ||
        a.orderInstanceId !== orderId ||
        a.effectiveDate !== effectiveDate
    ) ||
    applications.reduce((sum, a) => sum + a.amountMinor, 0n) !== money.amountMinor
  )
    throw new UnprocessableEntityError(
      'Receipt needs complete applications to one order on its book date; unapplications require correction'
    )
  const acceptances = await tx.query.FinancialSourceAcceptance.findMany({
    where: and(
      eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
      eq(schema.FinancialSourceAcceptance.moneyTransactionId, moneyTransactionId)
    ),
  })
  const evidence = []
  for (const acceptance of acceptances) {
    const object = await tx.query.FinancialSourceObject.findFirst({
      where: and(
        eq(schema.FinancialSourceObject.organizationId, organizationId),
        eq(schema.FinancialSourceObject.id, acceptance.sourceObjectId)
      ),
    })
    const account =
      object &&
      (await tx.query.FinancialSourceAccount.findFirst({
        where: and(
          eq(schema.FinancialSourceAccount.organizationId, organizationId),
          eq(schema.FinancialSourceAccount.id, object.sourceAccountId)
        ),
      }))
    if (!account) continue
    if (
      acceptance.state !== 'accepted' ||
      acceptance.orderInstanceId !== orderId ||
      account.environment !== 'live' ||
      account.archivedAt
    )
      throw new UnprocessableEntityError('Receipt source is unresolved, changed, or test data')
    const observation = await tx.query.FinancialSourceObservation.findFirst({
      where: and(
        eq(schema.FinancialSourceObservation.organizationId, organizationId),
        eq(schema.FinancialSourceObservation.id, acceptance.observationId),
        eq(schema.FinancialSourceObservation.sourceObjectId, object!.id)
      ),
    })
    const parsed = readStoredCustomerMoneyObservation(observation?.payload)
    if (!parsed.success || parsed.data.test)
      throw new UnprocessableEntityError('Receipt source observation is incomplete or test data')
    let fact: ReturnType<typeof confirmedCustomerMovement>
    try {
      fact = confirmedCustomerMovement(parsed.data)
    } catch (error) {
      throw new UnprocessableEntityError(
        `Receipt source is not a confirmed movement: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (
      fact.purpose !== money.purpose ||
      fact.amountMinor !== money.amountMinor ||
      fact.currency !== money.currency ||
      fact.occurredAt.getTime() !== money.occurredAt.getTime()
    )
      throw new UnprocessableEntityError('Receipt source no longer matches the canonical movement')
    const link = await tx.query.MoneySourceLink.findFirst({
      where: and(
        eq(schema.MoneySourceLink.organizationId, organizationId),
        eq(schema.MoneySourceLink.sourceObjectId, object!.id),
        eq(schema.MoneySourceLink.moneyTransactionId, money.id)
      ),
    })
    if (!link) throw new UnprocessableEntityError('Receipt source ownership is unresolved')
    evidence.push({
      object: object!,
      account,
      observation: observation!,
      gatewayHandle: parsed.data.gateway,
    })
  }
  if (evidence.length !== 1)
    throw new UnprocessableEntityError('Receipt needs one unambiguous accepted transaction source')
  const source = evidence[0]!
  // Task 71 U2: the movement's own gateway HANDLE decides its rail, and the
  // feed link is the fallback for a transaction that carries none.
  const handle = source.gatewayHandle?.trim() || null
  let paymentGatewayId: string | null
  if (handle && RESERVED_GATEWAY_HANDLES.includes(normaliseGatewayHandle(handle))) {
    // `manual` and `bogus` are money in no processor. No rail, so the movement
    // resolves through the "neither" shape and lands in undeposited funds.
    paymentGatewayId = null
  } else if (handle) {
    const gateways = await listPaymentGateways(tx, organizationId)
    if (gateways.isErr()) throw gateways.error
    const routes: GatewayRoute[] = toGatewayRoutes(gateways.value)
    const matched = matchGatewayRoute(handle, routes)
    if (!matched)
      throw new UnprocessableEntityError(
        `Receipt gateway handle "${handle}" is not mapped to a payment gateway. Map it under Accounting > Settings > Payment gateways.`
      )
    paymentGatewayId = matched
  } else {
    paymentGatewayId = source.account.paymentGatewayId
    if (!paymentGatewayId)
      throw new UnprocessableEntityError(
        'Receipt source feed has no payment gateway linked. Map it under Accounting > Settings > Payment gateways.'
      )
  }
  let gateway: PaymentGatewayRow | null = null
  if (paymentGatewayId) {
    const read = await getPaymentGateway(tx, organizationId, paymentGatewayId)
    if (read.isErr()) throw read.error
    if (!read.value)
      throw new UnprocessableEntityError('Receipt payment gateway is missing or archived')
    gateway = read.value
  }
  return {
    money,
    applications,
    orderId,
    effectiveDate,
    paymentGatewayId,
    sourceStoreId: source.account.id,
    sourceProvider: source.account.providerKey,
    sourceObjectId: source.object.id,
    sourceExternalId: source.object.externalId,
    sourceRevision: source.observation.id,
    gatewayName: gateway?.name ?? handle,
    storeDomain: source.account.externalAccountId,
    sourceHash: accountingBasisHash({
      money: {
        id: money.id,
        amount: money.amountMinor.toString(),
        occurredAt: money.occurredAt.toISOString(),
        currency: money.currency,
        party: money.partyInstanceId,
      },
      applications: applications.map((a) => ({
        id: a.id,
        orderId: a.orderInstanceId,
        amount: a.amountMinor.toString(),
        date: a.effectiveDate,
      })),
      observation: source.observation.contentHash,
      gateway: gateway ? JSON.parse(JSON.stringify(gateway)) : handle,
    }),
  }
}

/** How long a refused movement waits before the sweep offers it again. */
export const POSTING_RETRY_INTERVAL_MS = 60 * 60 * 1000

export interface CustomerMoneyCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Movements on or before it are refused forever. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`, the zone an instant's book month is cut in. */
  bookTimeZone: string
  /** Movements blocked more recently than this are held back. */
  retryBefore: Date
}

/**
 * Shopify customer receipts and refunds with no live subject posting.
 *
 * The claim is the candidate list: a movement that has posted holds a `subject`
 * row on `GlPostingSource`, and a reversal deletes that row, so the same query
 * re-offers a reversed movement without a state machine of its own.
 *
 * 🛑 **No head-of-line blocking.** A thousand receipts on an unmapped handle must
 * not stop a postable one from being reached, so a movement the ledger refused is
 * held back for {@link POSTING_RETRY_INTERVAL_MS} and then queued BEHIND every
 * movement nobody has tried yet. Anything before the opening cutoff is refused
 * forever and is excluded in SQL rather than re-refused every run.
 */
export async function listCustomerMoneyAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100,
  window?: CustomerMoneyCandidateWindow
): Promise<Array<{ id: string; purpose: 'customer_receipt' | 'customer_refund' }>> {
  const conditions = [
    eq(schema.MoneyTransaction.organizationId, organizationId),
    inArray(schema.MoneyTransaction.purpose, ['customer_receipt', 'customer_refund']),
    sql`EXISTS (SELECT 1 FROM ${schema.FinancialSourceAcceptance} acceptance
        JOIN ${schema.FinancialSourceObject} object ON object."id" = acceptance."sourceObjectId" AND object."organizationId" = acceptance."organizationId"
        JOIN ${schema.FinancialSourceAccount} account ON account."id" = object."sourceAccountId" AND account."organizationId" = object."organizationId"
        WHERE acceptance."organizationId" = ${organizationId} AND acceptance."moneyTransactionId" = ${schema.MoneyTransaction.id}
        AND account."providerKey" = 'shopify')`,
    sql`NOT EXISTS (SELECT 1 FROM ${schema.GlPostingSource} link
        WHERE link."organizationId" = ${organizationId}
        AND link."sourceKind" = 'money_transaction'
        AND link."sourceId" = ${schema.MoneyTransaction.id}
        AND link."linkRole" = 'subject')`,
  ]
  if (window?.cutoffPeriod)
    // The book month the poster would compute, in SQL: a date-precision movement
    // already IS its day; an instant is cut in the book zone.
    conditions.push(
      sql`to_char(COALESCE(${schema.MoneyTransaction.occurredOn}, (${schema.MoneyTransaction.occurredAt} AT TIME ZONE ${window.bookTimeZone})::date), 'YYYY-MM') > ${window.cutoffPeriod}`
    )
  if (window)
    conditions.push(
      sql`(${schema.MoneyTransaction.postingBlockedAt} IS NULL OR ${schema.MoneyTransaction.postingBlockedAt} <= ${window.retryBefore})`
    )

  const rows = await db
    .select({ id: schema.MoneyTransaction.id, purpose: schema.MoneyTransaction.purpose })
    .from(schema.MoneyTransaction)
    .where(and(...conditions))
    .orderBy(
      sql`${schema.MoneyTransaction.postingBlockedAt} ASC NULLS FIRST`,
      asc(schema.MoneyTransaction.createdAt),
      asc(schema.MoneyTransaction.id)
    )
    .limit(limit)
  return rows as Array<{ id: string; purpose: 'customer_receipt' | 'customer_refund' }>
}

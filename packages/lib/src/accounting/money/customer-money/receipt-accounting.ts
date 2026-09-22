// packages/lib/src/accounting/money/customer-money/receipt-accounting.ts
import { schema, type Transaction } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { NotFoundError, UnprocessableEntityError } from '../../../errors'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import type { PaymentGatewayRow } from '../../rails/client'
import {
  type GatewayRoute,
  GIFT_CARD_GATEWAY_HANDLE,
  matchGatewayRoute,
  normaliseGatewayHandle,
  RESERVED_GATEWAY_HANDLES,
  toGatewayRoutes,
} from '../../rails/client'
import { getPaymentGateway, listPaymentGateways } from '../../rails/reads'
import type { WorkItemCode } from '../../work-items/codes'
import { type WorkItemTagKeys, withWorkItemCode } from '../../work-items/refusal'
import {
  findSourceLink,
  listMovementApplications,
  readMovement,
  selectLiveApplications,
} from '../reads'
import { confirmedCustomerMovement } from './contracts'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'
import { readSourceAccount, readSourceObject } from './source-reads'

const refuse = (message: string, code: WorkItemCode, keys?: WorkItemTagKeys) =>
  new UnprocessableEntityError(message, withWorkItemCode(code, keys))

/** Read the canonical movement and its accepted source evidence under the commit lock. */
export async function readCustomerReceiptAccountingSource(
  tx: Transaction,
  organizationId: string,
  moneyTransactionId: string,
  // A channel refund resolves its rail by the same rules (91 D4).
  purpose: 'customer_receipt' | 'customer_refund' = 'customer_receipt'
) {
  const money = await readMovement(tx, organizationId, moneyTransactionId, { purpose })
  if (!money) throw new NotFoundError('Receipt movement does not exist')
  if (money.currency !== 'USD' || money.currencyExponent !== 2)
    throw refuse('Receipt requires a confirmed USD amount', 'MISSING_AMOUNT')
  if (!money.occurredAt) throw refuse('Receipt requires an occurrence instant', 'MISSING_DATE')
  const nativeOwnership = await tx.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, organizationId),
      eq(schema.MoneyCommand.kind, 'adopt_native_stripe_evidence'),
      sql`${schema.MoneyCommand.resultIds}->>'moneyTransactionId' = ${money.id}`
    ),
  })
  if (nativeOwnership)
    throw refuse(
      'Receipt is linked to native payment accounting; repair its existing accounting membership before switching ownership',
      'OWNERSHIP_CONFLICT'
    )
  // The order is a link, never an input to the lines (91 §4.0): a receipt applied
  // to no order, part of one, or two posts the same entry.
  const orders = new Set(
    selectLiveApplications(
      await listMovementApplications(tx, organizationId, moneyTransactionId)
    ).flatMap((a) => (a.orderInstanceId ? [a.orderInstanceId] : []))
  )
  const orderId = orders.size === 1 ? [...orders][0]! : null
  const acceptances = await tx.query.FinancialSourceAcceptance.findMany({
    where: and(
      eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
      eq(schema.FinancialSourceAcceptance.moneyTransactionId, moneyTransactionId)
    ),
  })
  const evidence = []
  for (const acceptance of acceptances) {
    const object = await readSourceObject(tx, organizationId, acceptance.sourceObjectId)
    const account = object && (await readSourceAccount(tx, organizationId, object.sourceAccountId))
    if (!account) continue
    if (account.environment !== 'live' || account.archivedAt) {
      const message = 'Receipt source feed is archived or in test mode'
      throw refuse(message, 'INVALID_EVIDENCE', { message })
    }
    if (acceptance.state !== 'accepted')
      throw refuse('Receipt source is not accepted yet', 'EVIDENCE_PENDING')
    const observation = await tx.query.FinancialSourceObservation.findFirst({
      where: and(
        eq(schema.FinancialSourceObservation.organizationId, organizationId),
        eq(schema.FinancialSourceObservation.id, acceptance.observationId),
        eq(schema.FinancialSourceObservation.sourceObjectId, object!.id)
      ),
    })
    const parsed = readStoredCustomerMoneyObservation(observation?.payload)
    if (!parsed.success || parsed.data.test) {
      const message = 'Receipt source observation is incomplete or test data'
      throw refuse(message, 'INVALID_EVIDENCE', { message })
    }
    let fact: ReturnType<typeof confirmedCustomerMovement>
    try {
      fact = confirmedCustomerMovement(parsed.data)
    } catch (error) {
      const message = `Receipt source is not a confirmed movement: ${error instanceof Error ? error.message : String(error)}`
      throw refuse(message, 'INVALID_EVIDENCE', { message })
    }
    if (
      fact.purpose !== money.purpose ||
      fact.amountMinor !== money.amountMinor ||
      fact.currency !== money.currency ||
      fact.occurredAt.getTime() !== money.occurredAt.getTime()
    )
      throw refuse('Receipt source no longer matches the canonical movement', 'MOVEMENT_CHANGED')
    const link = await findSourceLink(tx, organizationId, object!.id)
    if (link?.moneyTransactionId !== money.id)
      throw refuse('Receipt source ownership is unresolved', 'OWNERSHIP_CONFLICT')
    evidence.push({
      object: object!,
      account,
      observation: observation!,
      gatewayHandle: parsed.data.gateway,
    })
  }
  if (evidence.length === 0)
    throw refuse('Receipt has no channel transaction source', 'NO_DOCUMENT')
  if (evidence.length > 1)
    throw refuse('Receipt has more than one accepted transaction source', 'OWNERSHIP_CONFLICT')
  const source = evidence[0]!
  // Task 71 U2: the movement's own gateway HANDLE decides its rail, and the
  // feed link is the fallback for a transaction that carries none.
  const handle = source.gatewayHandle?.trim() || null
  // Paid with a gift card: no rail, the money is the cardholder's balance (91 D8).
  const giftCard = !!handle && normaliseGatewayHandle(handle) === GIFT_CARD_GATEWAY_HANDLE
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
      throw refuse(
        `Receipt gateway handle "${handle}" is not mapped to a payment gateway. Map it under Accounting > Settings > Payment gateways.`,
        'GATEWAY_UNMAPPED',
        { externalRef: handle }
      )
    paymentGatewayId = matched
  } else {
    paymentGatewayId = source.account.paymentGatewayId
    if (!paymentGatewayId)
      throw refuse(
        'Receipt source feed has no payment gateway linked. Map it under Accounting > Settings > Payment gateways.',
        'GATEWAY_UNMAPPED'
      )
  }
  let gateway: PaymentGatewayRow | null = null
  if (paymentGatewayId) {
    const read = await getPaymentGateway(tx, organizationId, paymentGatewayId)
    if (read.isErr()) throw read.error
    if (!read.value)
      throw refuse('Receipt payment gateway is missing or archived', 'ENDPOINT_UNRESOLVED', {
        railId: paymentGatewayId,
      })
    gateway = read.value
  }
  return {
    money,
    orderId,
    paymentGatewayId,
    giftCard,
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
      observation: source.observation.contentHash,
      gateway: gateway ? JSON.parse(JSON.stringify(gateway)) : handle,
    }),
  }
}

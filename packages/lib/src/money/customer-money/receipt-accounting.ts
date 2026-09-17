// packages/lib/src/money/customer-money/receipt-accounting.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import { getPaymentGateway } from '../../payment-gateways/reads'
import { accountingBasisHash } from '../../postings/effect-basis'
import { periodKeyForDate } from '../../postings/periods'
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
    evidence.push({ object: object!, account, observation: observation! })
  }
  if (evidence.length !== 1)
    throw new UnprocessableEntityError('Receipt needs one unambiguous accepted transaction source')
  const source = evidence[0]!
  // 58 D3/§5.6: the feed's own rail link - the processor
  // kind is retired and the account below resolves through the rail scope.
  const paymentGatewayId = source.account.paymentGatewayId
  if (!paymentGatewayId)
    throw new UnprocessableEntityError(
      'Receipt source feed has no payment gateway linked. Map it under Accounting > Settings > Payment gateways.'
    )
  const gateway = await getPaymentGateway(tx, organizationId, paymentGatewayId)
  if (gateway.isErr()) throw gateway.error
  if (!gateway.value)
    throw new UnprocessableEntityError('Receipt payment gateway is missing or archived')
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
    gatewayName: gateway.value.name,
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
      gateway: JSON.parse(JSON.stringify(gateway.value)),
    }),
  }
}

/** Retry missing and blocked work fairly, including dependencies repaired after discovery. */
export async function listCustomerReceiptAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100
) {
  const rows = await db
    .select({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .leftJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.moneyTransactionId, schema.MoneyTransaction.id),
        eq(schema.AccountingWork.effectKind, 'customer_receipt'),
        eq(schema.AccountingWork.operation, 'original')
      )
    )
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt'),
        sql`EXISTS (SELECT 1 FROM ${schema.FinancialSourceAcceptance} acceptance
        JOIN ${schema.FinancialSourceObject} object ON object."id" = acceptance."sourceObjectId" AND object."organizationId" = acceptance."organizationId"
        JOIN ${schema.FinancialSourceAccount} account ON account."id" = object."sourceAccountId" AND account."organizationId" = object."organizationId"
        WHERE acceptance."organizationId" = ${organizationId} AND acceptance."moneyTransactionId" = ${schema.MoneyTransaction.id}
        AND account."providerKey" = 'shopify')`,
        or(
          isNull(schema.AccountingWork.id),
          and(
            inArray(schema.AccountingWork.state, ['pending', 'blocked']),
            or(
              isNull(schema.AccountingWork.nextAttemptAt),
              lte(schema.AccountingWork.nextAttemptAt, new Date())
            )
          )
        )
      )
    )
    .orderBy(
      sql`COALESCE(${schema.AccountingWork.updatedAt}, ${schema.MoneyTransaction.createdAt})`,
      asc(schema.MoneyTransaction.id)
    )
    .limit(limit)
  return rows.map((row) => row.id)
}

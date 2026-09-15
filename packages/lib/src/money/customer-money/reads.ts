// packages/lib/src/money/customer-money/reads.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { OrderMoneyTransaction } from './client'
import { exactSourceMoney } from './contracts'
import { readStoredCustomerMoneyObservation } from './source-observation-adapter'

/** Read canonical movements and durable unresolved source outcomes beside an order. */
export async function listOrderMoneyTransactions(
  db: Database | Transaction,
  organizationId: string,
  orderId: string
): Promise<OrderMoneyTransaction[]> {
  const rows = await db
    .select({
      acceptance: schema.FinancialSourceAcceptance,
      money: schema.MoneyTransaction,
      object: schema.FinancialSourceObject,
      account: schema.FinancialSourceAccount,
      observation: schema.FinancialSourceObservation,
    })
    .from(schema.FinancialSourceAcceptance)
    .innerJoin(
      schema.FinancialSourceObject,
      and(
        eq(
          schema.FinancialSourceObject.organizationId,
          schema.FinancialSourceAcceptance.organizationId
        ),
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceAcceptance.sourceObjectId)
      )
    )
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceObject.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.FinancialSourceObject.sourceAccountId)
      )
    )
    .innerJoin(
      schema.FinancialSourceObservation,
      and(
        eq(
          schema.FinancialSourceObservation.organizationId,
          schema.FinancialSourceAcceptance.organizationId
        ),
        eq(schema.FinancialSourceObservation.id, schema.FinancialSourceAcceptance.observationId)
      )
    )
    .leftJoin(
      schema.MoneyTransaction,
      and(
        eq(schema.MoneyTransaction.organizationId, schema.FinancialSourceAcceptance.organizationId),
        eq(schema.MoneyTransaction.id, schema.FinancialSourceAcceptance.moneyTransactionId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceAcceptance.orderInstanceId, orderId)
      )
    )
    .orderBy(desc(schema.FinancialSourceAcceptance.createdAt))
  const result = new Map<string, OrderMoneyTransaction>()
  const moneyIds = [...new Set(rows.flatMap(({ money }) => (money ? [money.id] : [])))]
  const accountingRows = moneyIds.length
    ? await db
        .select({
          moneyTransactionId: schema.AccountingWork.moneyTransactionId,
          state: schema.AccountingWork.state,
          reason: schema.AccountingWork.blockedReason,
          effectiveDate: schema.AccountingWorkBasis.effectiveDate,
          glPostingId: schema.AccountingEffect.glPostingId,
        })
        .from(schema.AccountingWork)
        .leftJoin(
          schema.AccountingWorkBasis,
          and(
            eq(schema.AccountingWorkBasis.organizationId, organizationId),
            eq(schema.AccountingWorkBasis.workId, schema.AccountingWork.id),
            eq(schema.AccountingWorkBasis.version, schema.AccountingWork.basisVersion)
          )
        )
        .leftJoin(
          schema.AccountingEffect,
          and(
            eq(schema.AccountingEffect.organizationId, organizationId),
            eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
          )
        )
        .where(
          and(
            eq(schema.AccountingWork.organizationId, organizationId),
            inArray(schema.AccountingWork.moneyTransactionId, moneyIds),
            eq(schema.AccountingWork.effectKind, 'customer_receipt'),
            eq(schema.AccountingWork.operation, 'original')
          )
        )
    : []
  const accountingByMoney = new Map(accountingRows.map((row) => [row.moneyTransactionId, row]))
  for (const { acceptance, money, object, account, observation } of rows) {
    const source = readStoredCustomerMoneyObservation(observation.payload)
    let amount: { amountMinor: bigint; currency: string; currencyExponent: number } | null = null
    if (source.success) {
      try {
        amount = exactSourceMoney(source.data.amount, source.data.currency)
      } catch {
        /* Invalid source remains inspectable with its reason. */
      }
    }
    const id = money?.id ?? acceptance.id
    const prior = result.get(id)
    if (prior && acceptance.state !== 'blocked' && acceptance.state !== 'rejected') continue
    result.set(id, {
      id,
      hasMoneyTransaction: money !== null,
      purpose:
        money?.purpose ??
        (source.success && ['SALE', 'CAPTURE'].includes(source.data.kind.toUpperCase())
          ? 'customer_receipt'
          : source.success && source.data.kind.toUpperCase() === 'REFUND'
            ? 'customer_refund'
            : null),
      amountMinor: money?.amountMinor.toString() ?? amount?.amountMinor.toString() ?? null,
      currency: money?.currency ?? (source.success ? source.data.currency : null),
      currencyExponent: money?.currencyExponent ?? amount?.currencyExponent ?? null,
      occurredAt:
        money?.occurredAt?.toISOString() ?? (source.success ? source.data.processedAt : null),
      occurredOn: money?.occurredOn ?? null,
      reportingProvider: account.providerKey,
      processorRouteId: money?.paymentRouteId ?? null,
      sourceExternalId: object.externalId,
      status: acceptance.state,
      reason: acceptance.state === 'accepted' ? null : acceptance.reason,
      accounting: accountingByMoney.get(id) ?? null,
    })
  }
  return [...result.values()]
}

/** Source acquisition and acceptance are separate; an old connector cannot claim empty completion. */
export async function readOrderMoneyCoverage(
  db: Database | Transaction,
  organizationId: string,
  orderId: string
) {
  const stored = await db
    .select({ coverage: schema.FinancialSourceCoverage })
    .from(schema.FinancialSourceCoverage)
    .innerJoin(
      schema.FinancialSourceAccount,
      eq(schema.FinancialSourceAccount.id, schema.FinancialSourceCoverage.sourceAccountId)
    )
    .where(
      and(
        eq(schema.FinancialSourceCoverage.organizationId, organizationId),
        eq(schema.FinancialSourceCoverage.streamKey, 'order_transactions'),
        eq(schema.FinancialSourceCoverage.windowKey, orderId),
        eq(schema.FinancialSourceAccount.environment, 'live'),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )
  if (stored.length) {
    const rows = stored.map((row) => row.coverage),
      accounts = [...new Set(rows.map((row) => row.sourceAccountId))]
    return {
      sourceAvailable: true,
      sourceStoreId: accounts.length === 1 ? accounts[0]! : null,
      sourceStoreIds: accounts,
      complete: rows.every((row) => row.complete),
      fetched: rows.reduce((n, row) => n + row.fetchedCount, 0),
      accepted: rows.reduce((n, row) => n + row.acceptedCount, 0),
      pending: rows.reduce((n, row) => n + row.pendingCount, 0),
      rejected: rows.reduce((n, row) => n + row.rejectedCount, 0),
    }
  }
  return {
    sourceAvailable: false,
    sourceStoreId: null,
    sourceStoreIds: [],
    complete: false,
    fetched: 0,
    accepted: 0,
    pending: 0,
    rejected: 0,
  }
}

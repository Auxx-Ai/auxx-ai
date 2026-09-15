// packages/lib/src/money/customer-money/reads.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { OrderMoneyTransaction } from './client'
import { exactSourceMoney, shopifyMoneyObservationSchema, shopifySourceDomain } from './contracts'

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
    const source = shopifyMoneyObservationSchema.safeParse(observation.payload)
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
  const bindings = await db
    .select({
      externalId: schema.DataConnectorItem.externalId,
      metadata: schema.Credential.metadata,
    })
    .from(schema.DataConnectorItem)
    .innerJoin(
      schema.DataConnector,
      eq(schema.DataConnector.id, schema.DataConnectorItem.dataConnectorId)
    )
    .innerJoin(
      schema.Credential,
      and(
        eq(schema.Credential.organizationId, schema.DataConnectorItem.organizationId),
        eq(schema.Credential.id, schema.DataConnector.credentialId)
      )
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.entityInstanceId, orderId),
        eq(schema.DataConnector.type, 'app:shopify')
      )
    )
  const rows: Array<typeof schema.FinancialSourceCoverage.$inferSelect> = []
  let sourceAvailable = false
  const sourceStoreIds = new Set<string>()
  for (const binding of bindings) {
    let domain: string
    try {
      domain = shopifySourceDomain(binding.metadata)
    } catch {
      continue
    }
    const accounts = await db.query.FinancialSourceAccount.findMany({
      where: and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        eq(schema.FinancialSourceAccount.providerKey, 'shopify'),
        eq(schema.FinancialSourceAccount.externalAccountId, domain.toLowerCase()),
        eq(schema.FinancialSourceAccount.environment, 'live'),
        isNull(schema.FinancialSourceAccount.archivedAt)
      ),
      columns: { id: true },
    })
    if (!accounts.length) continue
    sourceAvailable = true
    for (const account of accounts) sourceStoreIds.add(account.id)
    rows.push(
      ...(await db.query.FinancialSourceCoverage.findMany({
        where: and(
          eq(schema.FinancialSourceCoverage.organizationId, organizationId),
          inArray(
            schema.FinancialSourceCoverage.sourceAccountId,
            accounts.map((account) => account.id)
          ),
          eq(schema.FinancialSourceCoverage.streamKey, 'shopify_order_transactions'),
          eq(schema.FinancialSourceCoverage.windowKey, binding.externalId)
        ),
      }))
    )
  }
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()]
  return {
    sourceAvailable,
    sourceStoreId: sourceStoreIds.size === 1 ? [...sourceStoreIds][0]! : null,
    shopifyBound: bindings.length > 0,
    sourceStoreIds: [...sourceStoreIds],
    complete: sourceAvailable && unique.length > 0 && unique.every((row) => row.complete),
    fetched: unique.reduce((sum, row) => sum + row.fetchedCount, 0),
    accepted: unique.reduce((sum, row) => sum + row.acceptedCount, 0),
    pending: unique.reduce((sum, row) => sum + row.pendingCount, 0),
    rejected: unique.reduce((sum, row) => sum + row.rejectedCount, 0),
  }
}

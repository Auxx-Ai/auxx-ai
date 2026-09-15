// packages/lib/src/money/customer-money/reads.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { RoleSourceScope } from '../../postings/types'
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

/**
 * Which SOURCE STORE an order's revenue belongs to, as a {@link RoleSourceScope}
 * (task 47 §5).
 *
 * The one predicate for the question, shared by every door that posts an order's
 * revenue, so two doors cannot come to different answers about one order:
 *
 * | coverage | answer | why |
 * | --- | --- | --- |
 * | no source evidence at all | `{ store: null }` - the MANUAL bucket | a hand-keyed order genuinely has no connected source, and `fulfillment-posting/reads.ts` takes the same branch (`if (!coverage?.sourceAvailable) continue`) |
 * | one live source account | `{ store: <id> }` | the storefront that sold it |
 * | evidence spanning two | `{}` - the ORG DEFAULT | 🛑 ambiguity falls back, it never guesses. `recognition-source.ts` BLOCKS this case for a posting that has to be exact; here the entry still has to post, so it posts to the account every store shared before this brief |
 *
 * 🛑 **`order_channel` is NOT consulted, and must not be.** It carries
 * `defaultValue: 'manual'` and is documented HUMAN-SET, never derived, so an
 * unlabelled Shopify order reads `manual` - keying on it would send most of a
 * store's revenue to the manual account (decision D4).
 */
export async function readOrderSourceScope(
  db: Database | Transaction,
  organizationId: string,
  orderId: string | null | undefined
): Promise<RoleSourceScope> {
  // No order at all is not evidence of a manual sale, it is the absence of the
  // question. Falls back to the org default rather than to the manual bucket.
  if (!orderId) return {}
  return (await readOrderSourceScopes(db, organizationId, [orderId])).get(orderId) ?? {}
}

/**
 * {@link readOrderSourceScope} for many orders in ONE query.
 *
 * What a batch posting reads. A day's credit memos or a month's shipments name
 * tens to thousands of orders, and asking per order is the N+1 this exists to
 * avoid. Same three answers, same rules; an order with no row in the result is
 * one with no coverage at all, which the caller reads as the manual bucket
 * through the map's own default.
 */
export async function readOrderSourceScopes(
  db: Database | Transaction,
  organizationId: string,
  orderIds: readonly string[]
): Promise<Map<string, RoleSourceScope>> {
  const wanted = [...new Set(orderIds.filter(Boolean))]
  const answer = new Map<string, RoleSourceScope>()
  if (wanted.length === 0) return answer

  const rows = await db
    .select({
      orderId: schema.FinancialSourceCoverage.windowKey,
      sourceAccountId: schema.FinancialSourceCoverage.sourceAccountId,
    })
    .from(schema.FinancialSourceCoverage)
    .innerJoin(
      schema.FinancialSourceAccount,
      eq(schema.FinancialSourceAccount.id, schema.FinancialSourceCoverage.sourceAccountId)
    )
    .where(
      and(
        eq(schema.FinancialSourceCoverage.organizationId, organizationId),
        eq(schema.FinancialSourceCoverage.streamKey, 'order_transactions'),
        inArray(schema.FinancialSourceCoverage.windowKey, wanted),
        eq(schema.FinancialSourceAccount.environment, 'live'),
        isNull(schema.FinancialSourceAccount.archivedAt)
      )
    )

  const byOrder = new Map<string, Set<string>>()
  for (const row of rows) {
    const bucket = byOrder.get(row.orderId) ?? new Set<string>()
    bucket.add(row.sourceAccountId)
    byOrder.set(row.orderId, bucket)
  }
  for (const orderId of wanted) {
    const accounts = byOrder.get(orderId)
    // No coverage row is "no connected source": the manual bucket. One account
    // is the store. Two is ambiguous and falls back to the org default rather
    // than picking one - see the table above.
    if (!accounts) answer.set(orderId, { store: null })
    else if (accounts.size === 1) answer.set(orderId, { store: [...accounts][0]! })
    else answer.set(orderId, {})
  }
  return answer
}

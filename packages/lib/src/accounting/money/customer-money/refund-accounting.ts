// packages/lib/src/accounting/money/customer-money/refund-accounting.ts

/**
 * A customer refund: credit memos drawn down, money out.
 *
 * ```
 *   Dr <each memo's credit-control account>   its settled slice
 *       Cr <bank, undeposited funds, or the original receipt's clearing>
 * ```
 *
 * Subject the `MoneyTransaction`, parent the order or invoice the memos credit,
 * counterparty the customer, `railId` the gateway the money went back through
 * (TARGET §5). The lines are `postings/build-refund-entry.ts`, which is pure.
 *
 * 🛑 **Each slice returns the credit to the account its memo actually credited**,
 * read off that memo's posted lines rather than re-resolved through the chart: a
 * role repointed since the memo was issued must not move the refund.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { AuxxError, ConflictError, UnprocessableEntityError } from '../../../errors'
import { readCreditMemoControlAccount } from '../../../sales/credit-memos/accounting'
import {
  loadCreditMemo,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../../sales/credit-memos/reads'
import { readOrganizationSettings } from '../../../settings/read'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import { buildRefundEntry, type RefundSettlementLine } from '../../ledger/builders/refund'
import { resolveBankAccountGlAccountInTx } from '../../ledger/chart/resolve-cash-account'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { postEntry } from '../../ledger/post/post-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { resolveRoles } from '../../ledger/roles/resolve-roles'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { FINALIZED_SETUP_STATE } from '../../ledger/setup/setup-readiness'
import type { GlPostingSourceInput } from '../../ledger/types'
import { resolvePaymentRoute } from '../bank-deposits/route'

const logger = createScopedLogger('customer-refund-accounting')

export interface CustomerRefundAccountingInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

export type CustomerRefundAccountingResult =
  | { status: 'accepted'; glPostingId: string }
  | { status: 'blocked'; reason: string }
  | { status: 'skipped'; reason: string }

type Settlement = {
  id: string
  amountMinor: bigint
  disposition: 'customer_credit' | 'vendor_credit' | 'unapplied_money'
  customerCreditMemoInstanceId: string | null
  originalTransactionId: string | null
}

/** Where the money left by, and the rail it left through when there was one. */
interface RefundRoute {
  endpointGlAccountId: string
  railId: string | null
  dimensions: Record<string, string>
  /** The original receipt's accounting date, when this refund follows one. */
  notBefore?: string
}

/**
 * The endpoint a refund with NO original receipt credits: the invoice receipt's
 * two-way choice with the sign flipped.
 *
 * 🛑 The org's `accounting.paymentRoute.<method>` setting decides which of the
 * two a method may take, and both wrong answers still balance - a `bank` refund
 * must name the account the money left, a `cash` one must not. `clearing` does
 * not carry over to a hand-recorded refund (there is no payout coming to drain
 * it), so it takes the recorder's explicit choice.
 */
async function readManualRoute(
  tx: Transaction,
  organizationId: string,
  money: typeof schema.MoneyTransaction.$inferSelect
): Promise<RefundRoute> {
  if (!money.method)
    throw new UnprocessableEntityError('Refund needs the method the money went back by')
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  const routing = resolvePaymentRoute(money.method, settings)
  const bankAccountInstanceId = money.cashAccountInstanceId
  if (routing === 'cash' && !bankAccountInstanceId)
    throw new UnprocessableEntityError('Refund must name the bank account the money left')
  if (routing === 'undeposited_funds' && bankAccountInstanceId)
    throw new UnprocessableEntityError(
      'Refund by this method comes out of undeposited funds and cannot name a bank account'
    )

  let endpointGlAccountId: string
  if (bankAccountInstanceId) {
    endpointGlAccountId = await resolveBankAccountGlAccountInTx(
      tx,
      organizationId,
      bankAccountInstanceId,
      'Refund'
    )
  } else {
    const roles = await resolveRoles(tx, organizationId, [ACCOUNT_ROLES.UNDEPOSITED_FUNDS])
    if (roles.isErr()) throw new UnprocessableEntityError(roles.error.message)
    const undeposited = roles.value.get(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
    if (!undeposited)
      throw new UnprocessableEntityError('Refund undeposited funds account is not mapped')
    endpointGlAccountId = undeposited.glAccountId
  }
  return {
    endpointGlAccountId,
    railId: null,
    dimensions: { refundMethod: money.method },
  }
}

/**
 * The route the ORIGINAL receipt took, read off its posted entry.
 *
 * The receipt's own posting carries `railId` and debits the gateway's clearing
 * account; a refund settles back through the same pair, so both are read from
 * the row rather than re-resolved. A receipt that never posted, or whose posting
 * has been reversed, has no route to inherit and refuses.
 */
async function readOriginalReceiptRoute(
  db: Database,
  organizationId: string,
  originalTransactionId: string
): Promise<RefundRoute> {
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: 'money_transaction',
    sourceId: originalTransactionId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value)
    throw new UnprocessableEntityError(
      'Refund original receipt has no posting to settle back through'
    )

  const [posting] = await db
    .select({ railId: schema.GlPosting.railId })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.id, live.value.id)
      )
    )
    .limit(1)
  const [debit] = await db
    .select({ glAccountId: schema.GlPostingLine.glAccountId })
    .from(schema.GlPostingLine)
    .where(
      and(
        eq(schema.GlPostingLine.organizationId, organizationId),
        eq(schema.GlPostingLine.glPostingId, live.value.id),
        eq(schema.GlPostingLine.direction, 'debit')
      )
    )
    .orderBy(asc(schema.GlPostingLine.lineNumber))
    .limit(1)
  if (!debit) throw new UnprocessableEntityError('Refund original receipt posting has no cash leg')

  return {
    endpointGlAccountId: debit.glAccountId,
    railId: posting?.railId ?? null,
    dimensions: posting?.railId ? { paymentGatewayId: posting.railId } : {},
    notBefore: live.value.txnDate,
  }
}

/** One credit memo's slice, with the control account its issue entry credited. */
async function readCreditControl(
  db: Database,
  organizationId: string,
  creditMemoInstanceId: string
): Promise<{ glAccountId: string; contactInstanceId: string | null; txnDate: string }> {
  const control = await readCreditMemoControlAccount(db, {
    organizationId,
    creditMemoInstanceId,
  })
  if (!control)
    throw new UnprocessableEntityError('Refund requires a posted credit memo to draw down')

  const memo = await loadCreditMemo(db, organizationId, creditMemoInstanceId)
  if (!memo || !Number.isSafeInteger(memo.totalMinor) || memo.totalMinor < 0)
    throw new ConflictError('Credit memo total is outside the supported amount range')

  const [applied, reserved] = await Promise.all([
    sumCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    sumReservedCreditMemoRefunds(db, organizationId, memo),
  ])
  if (applied + reserved > memo.totalMinor)
    throw new ConflictError('Refund exceeds the remaining credit memo entitlement')

  return {
    glAccountId: control.glAccountId,
    contactInstanceId: memo.contactInstanceId,
    txnDate: control.txnDate,
  }
}

interface PreparedRefund {
  entry: ReturnType<typeof buildRefundEntry>
  sources: GlPostingSourceInput[]
  railId: string | null
}

async function prepareCustomerRefund(
  db: Database,
  input: CustomerRefundAccountingInput,
  zone: string | null
): Promise<PreparedRefund> {
  const money = await db.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, input.organizationId),
      eq(schema.MoneyTransaction.id, input.moneyTransactionId),
      eq(schema.MoneyTransaction.purpose, 'customer_refund')
    ),
  })
  if (!money || money.currency !== 'USD' || money.currencyExponent !== 2)
    throw new UnprocessableEntityError('Refund requires a confirmed USD movement')
  if (
    (money.datePrecision === 'instant' && !money.occurredAt) ||
    (money.datePrecision === 'date' && !money.occurredOn)
  )
    throw new UnprocessableEntityError('Refund occurrence date is incomplete')

  if (!zone) throw new UnprocessableEntityError('Book time zone is not configured')
  const effectiveDate =
    money.datePrecision === 'date'
      ? money.occurredOn!
      : periodKeyForDate(money.occurredAt!, 'day', zone)

  const settlements = (await db.query.MoneyRefundSettlement.findMany({
    where: and(
      eq(schema.MoneyRefundSettlement.organizationId, input.organizationId),
      eq(schema.MoneyRefundSettlement.refundTransactionId, money.id)
    ),
    orderBy: asc(schema.MoneyRefundSettlement.id),
  })) as Settlement[]
  if (!settlements.length) throw new UnprocessableEntityError('Refund has no settlement partition')
  if (
    settlements.some((s) => s.disposition !== 'customer_credit' || !s.customerCreditMemoInstanceId)
  )
    throw new UnprocessableEntityError('Only customer-credit refund dispositions are supported')
  const total = settlements.reduce((sum, s) => sum + s.amountMinor, 0n)
  if (total !== money.amountMinor)
    throw new ConflictError('Refund settlement partitions do not equal the movement amount')

  const customerInstanceId = money.partyInstanceId
  if (!customerInstanceId)
    throw new UnprocessableEntityError('Refund requires the customer it goes back to')

  const lines: RefundSettlementLine[] = []
  for (const settlement of settlements) {
    const memoId = settlement.customerCreditMemoInstanceId!
    const control = await readCreditControl(db, input.organizationId, memoId)
    if (control.contactInstanceId !== customerInstanceId)
      throw new UnprocessableEntityError(
        'Refund requires the customer party to match every credit memo'
      )
    if (control.txnDate > effectiveDate)
      throw new ConflictError('Refund date precedes the credit memo it draws down')
    lines.push({
      settlementId: settlement.id,
      creditMemoInstanceId: memoId,
      creditControlGlAccountId: control.glAccountId,
      amountMinor: toLedgerMinor(settlement.amountMinor, 'USD', 2),
    })
  }

  const originalIds = [
    ...new Set(settlements.map((s) => s.originalTransactionId).filter(Boolean)),
  ] as string[]
  if (originalIds.length > 1)
    throw new UnprocessableEntityError('Refund partitions have different original receipt routes')
  const route = originalIds[0]
    ? await readOriginalReceiptRoute(db, input.organizationId, originalIds[0])
    : await db.transaction((tx) => readManualRoute(tx, input.organizationId, money))
  if (route.notBefore && route.notBefore > effectiveDate)
    throw new ConflictError('Refund date precedes the original receipt posting')

  const entry = buildRefundEntry({
    moneyTransactionId: money.id,
    txnDate: effectiveDate,
    settlements: lines,
    endpointGlAccountId: route.endpointGlAccountId,
    endpointDimensions: Object.keys(route.dimensions).length ? route.dimensions : undefined,
    customerInstanceId,
  })

  // The parent is the document the memos credit, when they agree on one. A
  // refund spanning two orders has no single parent and carries none.
  const memos = await Promise.all(
    lines.map((line) => loadCreditMemo(db, input.organizationId, line.creditMemoInstanceId))
  )
  const parents = [
    ...new Set(memos.map((memo) => memo?.orderInstanceId ?? memo?.invoiceInstanceId ?? null)),
  ]
  const parentId = parents.length === 1 ? parents[0] : null
  const parentKind = memos[0]?.orderInstanceId ? 'order' : 'invoice'

  const sources: GlPostingSourceInput[] = [
    { sourceKind: 'money_transaction', sourceId: money.id, linkRole: 'subject' },
    ...(parentId
      ? [{ sourceKind: parentKind, sourceId: parentId, linkRole: 'parent' as const }]
      : []),
    { sourceKind: 'contact', sourceId: customerInstanceId, linkRole: 'counterparty' },
  ]
  return { entry, sources, railId: route.railId }
}

/**
 * Post one customer refund.
 *
 * A refusal is a `blocked` result rather than a throw: the money has already
 * moved, and the caller records that whether or not the books accepted it.
 */
export async function postCustomerRefundAccounting(
  db: Database,
  input: CustomerRefundAccountingInput
): Promise<CustomerRefundAccountingResult> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (live.isErr()) return { status: 'blocked', reason: live.error.message }
  if (live.value) return { status: 'accepted', glPostingId: live.value.id }

  if (!(await isAccountingEnabled(db, input.organizationId)))
    return { status: 'skipped', reason: 'Accounting is not enabled' }

  let prepared: PreparedRefund
  try {
    const settings = await readOrganizationSettings(input.organizationId, [
      'accounting.setupState',
      'accounting.bookTimeZone',
      'accounting.cutoffPeriod',
    ] as const)
    if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE)
      throw new UnprocessableEntityError(
        'Finalize accounting setup before posting customer refunds'
      )
    prepared = await prepareCustomerRefund(db, input, settings['accounting.bookTimeZone'])
    const cutoff = settings['accounting.cutoffPeriod']
    if (cutoff && prepared.entry.entry.txnDate.slice(0, 7) <= cutoff)
      throw new UnprocessableEntityError(`Refund is before the accounting opening cutoff ${cutoff}`)
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    logger.warn('A customer refund could not be prepared', {
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      error: error.message,
    })
    return { status: 'blocked', reason: error.message }
  }

  const lock = await resolvePeriodLock(input.organizationId)
  const post = await postEntry(db, {
    organizationId: input.organizationId,
    entry: prepared.entry.entry,
    actorUserId: input.actorUserId,
    lock,
    memo: `Customer refund - movement ${input.moneyTransactionId}`,
    sources: prepared.sources,
    railId: prepared.railId,
    ...(prepared.railId ? { scope: { rail: prepared.railId } } : {}),
    mode: await readAutoPostMode(input.organizationId, 'refund'),
  })
  if (!didLedgerAccept(post) || !post.glPostingId)
    return { status: 'blocked', reason: post.error ?? `The ledger answered ${post.status}` }
  return { status: 'accepted', glPostingId: post.glPostingId }
}

// packages/lib/src/accounting/money/customer-money/refund-accounting.ts

/**
 * A customer refund: `Dr accounts_receivable / Cr <endpoint>`, the movement's amount,
 * from its own facts (91 D4). It waits for no memo, no memo posting and no receipt
 * posting; the memo it settles is a link, written whenever both sides exist
 * ({@link linkRefundPostingToMemos}).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { buildRefundEntry } from '../../ledger/builders/refund'
import { insertSourceLinksInTx } from '../../ledger/post/insert-posting'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import {
  type CreditMemoRecord,
  loadCreditMemo,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../sales/credit-memos/reads'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { readMatchedDisputeFeeMinor } from '../payouts/entry-reads'
import {
  type LoadedMovement,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from '../post-movement'
import { listRefundSettlements, type MoneyRefundSettlementRow } from '../reads'
import { readCustomerReceiptAccountingSource } from './receipt-accounting'

type Db = Database | Transaction

export interface CustomerRefundAccountingInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

export type CustomerRefundAccountingResult = MovementPostingResult

/** The refund's customer-credit settlements and the memos they name, as they stand now. */
async function readSettledMemos(
  db: Db,
  organizationId: string,
  refundTransactionId: string
): Promise<{ settlements: MoneyRefundSettlementRow[]; memos: CreditMemoRecord[] }> {
  const settlements = (
    await listRefundSettlements(db, organizationId, { refundTransactionId })
  ).filter((row) => row.disposition === 'customer_credit' && row.customerCreditMemoInstanceId)
  const memoIds = [...new Set(settlements.map((row) => row.customerCreditMemoInstanceId!))]
  const memos = await Promise.all(memoIds.map((id) => loadCreditMemo(db, organizationId, id)))
  return { settlements, memos: memos.filter((memo): memo is CreditMemoRecord => memo !== null) }
}

async function prepareRefund(
  tx: Transaction,
  organizationId: string,
  loaded: LoadedMovement
): Promise<PreparedMovement> {
  const money = loaded.money
  const acceptances = await tx
    .select({ orderInstanceId: schema.FinancialSourceAcceptance.orderInstanceId })
    .from(schema.FinancialSourceAcceptance)
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceAcceptance.moneyTransactionId, money.id)
      )
    )
  // A channel refund resolves its rail from its own gateway handle, as a receipt does.
  const source = acceptances.length
    ? await readCustomerReceiptAccountingSource(tx, organizationId, money.id, 'customer_refund')
    : null
  if (source?.paymentGatewayId) await loaded.stampGateway(source.paymentGatewayId)
  // A refund back onto a gift card restores the cardholder's balance.
  if (source?.giftCard) loaded.markGiftCard()

  const { settlements, memos } = await readSettledMemos(tx, organizationId, money.id)
  for (const memo of memos) {
    if (!Number.isSafeInteger(memo.totalMinor) || memo.totalMinor < 0)
      throw new ConflictError('Credit memo total is outside the supported amount range')
    if (memo.issuedAt && memo.issuedAt > loaded.effectiveDate)
      throw new ConflictError('Refund date precedes the credit memo it settles')
  }

  const customerId =
    money.partyInstanceId ??
    (await readOrganizationSettings(organizationId, ['accounting.guestContactId'] as const))[
      'accounting.guestContactId'
    ]
  if (!customerId)
    throw new UnprocessableEntityError(
      'Refund has no customer and the organization has no guest customer'
    )

  const endpoint = await loaded.endpoint()
  const endpointDimensions = {
    ...(money.method ? { refundMethod: money.method } : {}),
    ...(endpoint.railId ? { paymentGatewayId: endpoint.railId } : {}),
  }
  const built = buildRefundEntry({
    moneyTransactionId: money.id,
    txnDate: loaded.effectiveDate,
    amountMinor: toLedgerMinor(money.amountMinor, 'USD', 2),
    endpointGlAccountId: endpoint.glAccountId,
    endpointRole: endpoint.role,
    ...(Object.keys(endpointDimensions).length ? { endpointDimensions } : {}),
    customerInstanceId: customerId,
    // A chargeback: the processor's matched dispute row is this movement's own evidence.
    feeMinor: await readMatchedDisputeFeeMinor(tx, organizationId, money.id),
    // A native refund writes its one settlement with the movement, so the dimension is a fact of it.
    ...(!source && settlements.length === 1 ? { settlementId: settlements[0]!.id } : {}),
  })

  // The movement's own document: the channel's order, or the one a native refund settles.
  const orders = [...new Set(acceptances.flatMap((row) => row.orderInstanceId ?? []))]
  const documents = [
    ...new Set(memos.map((memo) => memo.orderInstanceId ?? memo.invoiceInstanceId ?? '')),
  ]
  const parent =
    orders.length === 1
      ? { sourceKind: 'order', sourceId: orders[0]! }
      : !source && memos.length === 1 && documents[0]
        ? {
            sourceKind: memos[0]!.orderInstanceId ? 'order' : 'invoice',
            sourceId: documents[0],
          }
        : null

  return {
    lines: built.entry.lines,
    ...(parent ? { parent } : {}),
    counterparty: { sourceKind: 'contact', sourceId: customerId },
    storeId: source?.sourceStoreId ?? null,
  }
}

/**
 * The link step (91 §4.4): the memos a posted refund settles become `parent` links on
 * its posting, and a refund larger than a memo's remaining credit is a
 * `REFUND_EXCEEDS_MEMO` warning - the entry stands. A no-op until the refund has posted.
 */
export async function linkRefundPostingToMemos(
  db: Db,
  organizationId: string,
  refundTransactionId: string
): Promise<void> {
  const live = await findLiveSubjectPosting(db as Database, {
    organizationId,
    sourceKind: 'money_transaction',
    sourceId: refundTransactionId,
  })
  if (live.isErr() || !live.value) return
  const glPostingId = live.value.id
  const { memos } = await readSettledMemos(db, organizationId, refundTransactionId)
  if (memos.length === 0) return

  const linked = await db
    .select({ sourceId: schema.GlPostingSource.sourceId })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.glPostingId, glPostingId),
        eq(schema.GlPostingSource.sourceKind, 'credit_memo'),
        eq(schema.GlPostingSource.linkRole, 'parent')
      )
    )
  const has = new Set(linked.map((row) => row.sourceId))
  const missing = memos.filter((memo) => !has.has(memo.id))
  if (missing.length)
    await insertSourceLinksInTx(db, {
      organizationId,
      glPostingId,
      sources: missing.map((memo) => ({
        sourceKind: 'credit_memo',
        sourceId: memo.id,
        linkRole: 'parent' as const,
      })),
    })

  const exceeded: string[] = []
  for (const memo of memos) {
    const [applied, reserved] = await Promise.all([
      sumCreditMemoApplications(db, organizationId, memo.id),
      sumReservedCreditMemoRefunds(db, organizationId, memo),
    ])
    if (applied + reserved > memo.totalMinor) exceeded.push(memo.id)
  }
  const key = {
    sourceKind: 'money_transaction',
    sourceId: refundTransactionId,
    stage: 'post' as const,
  }
  if (exceeded.length)
    await upsertWorkItem(db, organizationId, {
      ...key,
      reasonCode: 'REFUND_EXCEEDS_MEMO',
      detail: { creditMemoInstanceIds: exceeded },
    })
  else await deleteWorkItem(db, organizationId, key)
}

/**
 * Post one customer refund. A refusal is a `blocked` result, never a throw: the
 * money has already moved, and the caller records that either way.
 */
export async function postCustomerRefundAccounting(
  db: Database,
  input: CustomerRefundAccountingInput
): Promise<CustomerRefundAccountingResult> {
  const result = await postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'customer_refund',
    label: 'Refund',
    actorUserId: input.actorUserId,
    prepare: (tx, loaded) => prepareRefund(tx, input.organizationId, loaded),
  })
  // After the poster, which clears the movement's `post` row on acceptance.
  if (result.status === 'accepted')
    await linkRefundPostingToMemos(db, input.organizationId, input.moneyTransactionId)
  return result
}

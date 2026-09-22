// packages/lib/src/accounting/money/customer-money/refund-accounting.ts

/**
 * A customer refund: credit memos drawn down, money out.
 *
 * ```
 *   Dr <each memo's credit-control account>   its settled slice
 *       Cr <the cash endpoint the money left by>
 * ```
 *
 * Subject the `MoneyTransaction`, parent the order or invoice the memos credit,
 * counterparty the customer (TARGET §5). The lines are
 * `ledger/builders/refund.ts`, which is pure.
 *
 * 🛑 **Each slice returns the credit to the account its memo actually credited**,
 * read off that memo's posted lines rather than re-resolved through the chart: a
 * role repointed since the memo was issued must not move the refund. The ENDPOINT
 * is the opposite — a refund is a forward event and resolves its own rail or bank
 * account at refund time (D5).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { buildRefundEntry, type RefundSettlementLine } from '../../ledger/builders/refund'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { readCreditMemoControlAccount } from '../../sales/credit-memos/accounting'
import {
  loadCreditMemo,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../sales/credit-memos/reads'
import { type MovementPostingResult, postMovementEntry } from '../post-movement'
import { listRefundSettlements } from '../reads'

export interface CustomerRefundAccountingInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

export type CustomerRefundAccountingResult = MovementPostingResult

type Settlement = {
  id: string
  amountMinor: bigint
  disposition: 'customer_credit' | 'vendor_credit' | 'unapplied_money'
  customerCreditMemoInstanceId: string | null
  originalTransactionId: string | null
}

/** One credit memo's slice, with the control account its issue entry credited. */
async function readCreditControl(
  db: Database | Transaction,
  organizationId: string,
  creditMemoInstanceId: string
): Promise<{ glAccountId: string; contactInstanceId: string | null; txnDate: string }> {
  const control = await readCreditMemoControlAccount(db as Database, {
    organizationId,
    creditMemoInstanceId,
  })
  if (!control)
    throw new UnprocessableEntityError('Refund requires a posted credit memo to draw down')

  const memo = await loadCreditMemo(db as Database, organizationId, creditMemoInstanceId)
  if (!memo || !Number.isSafeInteger(memo.totalMinor) || memo.totalMinor < 0)
    throw new ConflictError('Credit memo total is outside the supported amount range')

  const [applied, reserved] = await Promise.all([
    sumCreditMemoApplications(db as Database, organizationId, creditMemoInstanceId),
    sumReservedCreditMemoRefunds(db as Database, organizationId, memo),
  ])
  if (applied + reserved > memo.totalMinor)
    throw new ConflictError('Refund exceeds the remaining credit memo entitlement')

  return {
    glAccountId: control.glAccountId,
    contactInstanceId: memo.contactInstanceId,
    txnDate: control.txnDate,
  }
}

/**
 * The accounting date of the receipt this refund settles, when it settles one.
 *
 * Only the date is read: the endpoint is the refund's own (D5). A receipt that
 * never posted, or whose posting has been reversed, has nothing to precede.
 */
async function readOriginalReceiptDate(
  db: Database | Transaction,
  organizationId: string,
  originalTransactionId: string
): Promise<string> {
  const live = await findLiveSubjectPosting(db as Database, {
    organizationId,
    sourceKind: 'money_transaction',
    sourceId: originalTransactionId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value)
    throw new UnprocessableEntityError(
      'Refund original receipt has no posting to settle back through'
    )
  return live.value.txnDate
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
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'customer_refund',
    label: 'Refund',
    actorUserId: input.actorUserId,
    prepare: async (tx, loaded) => {
      const money = loaded.money
      const settlements = (await listRefundSettlements(tx, input.organizationId, {
        refundTransactionId: money.id,
      })) as Settlement[]
      if (!settlements.length)
        throw new UnprocessableEntityError('Refund has no settlement partition')
      if (
        settlements.some(
          (s) => s.disposition !== 'customer_credit' || !s.customerCreditMemoInstanceId
        )
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
        const control = await readCreditControl(tx, input.organizationId, memoId)
        if (control.contactInstanceId !== customerInstanceId)
          throw new UnprocessableEntityError(
            'Refund requires the customer party to match every credit memo'
          )
        if (control.txnDate > loaded.effectiveDate)
          throw new ConflictError('Refund date precedes the credit memo it draws down')
        lines.push({
          settlementId: settlement.id,
          creditMemoInstanceId: memoId,
          creditControlGlAccountId: control.glAccountId,
          amountMinor: toLedgerMinor(settlement.amountMinor, 'USD', 2),
        })
      }

      // A refund may not precede the receipt it settles.
      const originalIds = [
        ...new Set(settlements.map((s) => s.originalTransactionId).filter(Boolean)),
      ] as string[]
      for (const originalId of originalIds) {
        const notBefore = await readOriginalReceiptDate(tx, input.organizationId, originalId)
        if (notBefore > loaded.effectiveDate)
          throw new ConflictError('Refund date precedes the original receipt posting')
      }

      const endpoint = await loaded.endpoint()
      const endpointDimensions = {
        ...(money.method ? { refundMethod: money.method } : {}),
        ...(endpoint.railId ? { paymentGatewayId: endpoint.railId } : {}),
      }
      const built = buildRefundEntry({
        moneyTransactionId: money.id,
        txnDate: loaded.effectiveDate,
        settlements: lines,
        endpointGlAccountId: endpoint.glAccountId,
        ...(Object.keys(endpointDimensions).length ? { endpointDimensions } : {}),
        customerInstanceId,
      })

      // The parent is the document the memos credit, when they agree on one. A
      // refund spanning two orders has no single parent and carries none.
      const memos = await Promise.all(
        lines.map((line) =>
          loadCreditMemo(tx as unknown as Database, input.organizationId, line.creditMemoInstanceId)
        )
      )
      const parents = [
        ...new Set(memos.map((memo) => memo?.orderInstanceId ?? memo?.invoiceInstanceId ?? null)),
      ]
      const parentId = parents.length === 1 ? parents[0] : null
      const parentKind = memos[0]?.orderInstanceId ? 'order' : 'invoice'

      return {
        lines: built.entry.lines,
        ...(parentId ? { parent: { sourceKind: parentKind, sourceId: parentId } } : {}),
        counterparty: { sourceKind: 'contact', sourceId: customerInstanceId },
      }
    },
  })
}

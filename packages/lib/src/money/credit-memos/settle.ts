// packages/lib/src/money/credit-memos/settle.ts
//
// The settlement writer: the ONLY writer of `credit_memo_amount_applied`,
// `credit_memo_amount_refunded` (native), `credit_memo_balance` and of the
// `issued <-> settled` flip. Every writer in this module ends by calling it,
// and the manual refund rail should too (plans/accounting/tasks/10 section 5.3).
//
// Re-sums from the SOURCES on every call - the application rows and the
// succeeded refund transactions - never from the mirrors it is about to
// rewrite, for the reason `syncInvoicePaymentState` re-sums allocations: a
// mirror is a projection, and a projection that feeds itself drifts.

import { type Database, database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getEntityDefIdResolver } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import type { CreditMemoStatus } from './client'
import {
  requireCreditMemo,
  sumCreditMemoApplications,
  sumSucceededCreditMemoRefunds,
} from './reads'

/**
 * The one field the settlement projection writes past the status wall.
 *
 * `credit_memo_status` carries a lifecycle guard on both chains
 * (`resources/hooks/credit-memo-hooks.ts` for the CRUD path, and whatever field
 * pre-hook the registry grows). `FieldValueService` clears the system pre-hook
 * structurally and honours `bypassFieldGuards` for the field chain, which is
 * the identical mechanism `INVOICE_STATUS_BYPASS` uses in `payments/ledger.ts`.
 * It names the status and nothing else: the three amounts carry no guard.
 */
export const CREDIT_MEMO_STATUS_BYPASS = new Set<SystemAttribute>(['credit_memo_status'])

export interface SettleCreditMemoInput {
  organizationId: string
  userId: string
  creditMemoInstanceId: string
}

/** What the settlement wrote, or found already written. */
export interface CreditMemoSettlementState {
  /** Integer minor units. */
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  status: CreditMemoStatus | string
}

/**
 * Re-derive applied, refunded and balance from their sources, write the three
 * mirrors, and flip `issued <-> settled` on the balance.
 *
 * - `applied` is the sum of the memo's `credit_memo_application` rows.
 * - `refunded` is, for a native memo, the sum of `succeeded` refund
 *   `PaymentTransaction`s carrying `creditMemoInstanceId`; for a channel memo
 *   it is the connector's transcribed figure and is left alone (section 2.1).
 * - `balance = total - applied - refunded`, floored at zero.
 *
 * A `draft` gets its amounts written (they are zero) but never a status: only
 * `issueCreditMemo` moves a draft. A `void` memo is left exactly as it is; its
 * balance is ignored by definition (section 2.4). A `settled` memo whose refund
 * later fails goes back to `issued` here, because the balance reappears.
 *
 * Writes only what changed, to avoid no-op event churn.
 */
export async function settleCreditMemo(
  db: Database,
  input: SettleCreditMemoInput
): Promise<CreditMemoSettlementState> {
  const { organizationId, userId, creditMemoInstanceId } = input
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)

  if (memo.status === 'void') {
    return {
      amountAppliedMinor: memo.amountAppliedMinor,
      amountRefundedMinor: memo.amountRefundedMinor,
      balanceMinor: memo.balanceMinor,
      status: memo.status,
    }
  }

  const [amountAppliedMinor, refundedFromLedger] = await Promise.all([
    sumCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    memo.source === 'channel'
      ? Promise.resolve(memo.amountRefundedMinor)
      : sumSucceededCreditMemoRefunds(db, organizationId, creditMemoInstanceId),
  ])
  const amountRefundedMinor = refundedFromLedger
  const balanceMinor = Math.max(0, memo.totalMinor - amountAppliedMinor - amountRefundedMinor)

  let nextStatus = memo.status
  if (memo.status === 'issued' || memo.status === 'settled') {
    nextStatus = balanceMinor <= 0 ? 'settled' : 'issued'
  }

  const writes: Array<{ fieldId: string; value: unknown }> = []
  if (memo.hasSettlementFields) {
    if (amountAppliedMinor !== memo.amountAppliedMinor) {
      writes.push({ fieldId: 'credit_memo_amount_applied', value: amountAppliedMinor })
    }
    if (memo.source !== 'channel' && amountRefundedMinor !== memo.amountRefundedMinor) {
      writes.push({ fieldId: 'credit_memo_amount_refunded', value: amountRefundedMinor })
    }
    if (balanceMinor !== memo.balanceMinor) {
      writes.push({ fieldId: 'credit_memo_balance', value: balanceMinor })
    }
  }
  if (nextStatus !== memo.status) {
    writes.push({ fieldId: 'credit_memo_status', value: nextStatus })
  }

  if (writes.length > 0) {
    // The type slug is resolved to the real def id before writing, for the
    // reason `markInvoiceSent` records: an unresolved `credit_memo:<id>` makes
    // every field-change hook on the write silently no-op.
    const resolveDefId = await getEntityDefIdResolver(organizationId)
    const fieldValueService = new FieldValueService(
      organizationId,
      userId,
      db === database ? undefined : db,
      undefined,
      { bypassFieldGuards: CREDIT_MEMO_STATUS_BYPASS }
    )
    await fieldValueService.setValuesForEntity({
      recordId: toRecordId(resolveDefId('credit_memo'), creditMemoInstanceId),
      values: writes,
    })
  }

  return { amountAppliedMinor, amountRefundedMinor, balanceMinor, status: nextStatus }
}

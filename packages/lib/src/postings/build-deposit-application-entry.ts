// packages/lib/src/postings/build-deposit-application-entry.ts

/**
 * The deposit application entry: a held prepayment becoming a settled invoice.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr customer_deposits        the reclassed amount
 *       Cr accounts_receivable    the same
 * ```
 *
 * ## Why this is a SECOND entry and not an amendment of the first
 *
 * `buildPaymentEntry` books what was true when the money arrived: a deposit
 * taken on quote acceptance, before any invoice existed, was owed to the
 * customer, so the receipt credited `customer_deposits`. That entry is never
 * amended when allocations change later - not because the claim index makes it
 * awkward, but because it is correct. On the day the money came in, none of it
 * was owed to us.
 *
 * When the deposit is later applied to an invoice, the money moves out of the
 * liability and relieves the receivable that invoice raised. That is its own
 * event on its own day, and it gets its own entry, dated the day the allocation
 * was made rather than the day the money arrived.
 *
 * ## It is neither a payment nor a manual journal
 *
 * No money moves - both legs are balance-sheet accounts - so it is not a
 * payment. Nobody keyed it - `applyHeldDepositsToInvoice` does it on settle -
 * so it is not a manual journal. Hence its own posting type,
 * `deposit_application`, prefix `DPA`.
 *
 * ## 🛑 The interlock with the invoice issuance entry
 *
 * The credit here relieves a receivable that `build-invoice-entry.ts` is what
 * raises. Without an issuance entry on the invoice, this credit relieves a
 * receivable that never existed - the same class of error as booking the
 * deposit against `accounts_receivable` in the first place, moved one document
 * along. The two ship together.
 *
 * @see plans/accounting/tasks/07-customer-deposits.md
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { hashedPeriodKey } from './period-key'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * The `sourceType` every application line carries.
 *
 * 🛑 `payment_transaction`, the same value the receipt entry uses, and
 * deliberately not the allocation row.
 *
 * Two readers depend on it. `listPaymentPostings` finds every entry a payment
 * produced by this pair, which is what lets `reversePaymentPostings` back the
 * reclass out before the receipt when a payment is deleted; and
 * `postDepositApplications` computes how much of a transaction is still sitting
 * in the liability by reading its own lines back out of the ledger rather than
 * from a column that could drift. Sourcing on the allocation would hide the
 * entry from both.
 *
 * WHICH allocation an entry belongs to is carried by the period key, which is a
 * deterministic function of the allocation id - see
 * {@link depositApplicationPeriodKey}.
 */
export const DEPOSIT_APPLICATION_SOURCE_TYPE = 'payment_transaction'

/** The posting type an application entry claims. */
export const DEPOSIT_APPLICATION_POSTING_TYPE = 'deposit_application' as const

/** The prefix an application's minted key carries. */
export const DEPOSIT_APPLICATION_PERIOD_KEY_PREFIX = 'DPA'

/**
 * Mint the period key for one deposit application, from the ALLOCATION's id.
 *
 * A short hash, never a counted sequence, for the reason `period-key.ts` sets
 * out at length: two concurrent applications minting one key would converge the
 * loser to `already_posted`, a SUCCESS, and one customer's money would
 * disappear into the other's entry.
 *
 * Keying on the allocation rather than the transaction is what makes a PARTIAL
 * application work. One deposit split across two invoices is two allocations,
 * two keys and two entries; keying on the transaction would let the first
 * application swallow the second.
 */
export function depositApplicationPeriodKey(allocationId: string): string {
  return hashedPeriodKey({
    prefix: DEPOSIT_APPLICATION_PERIOD_KEY_PREFIX,
    sourceId: allocationId,
    label: 'deposit application entry',
    idLabel: 'allocation id',
  })
}

export interface BuildDepositApplicationEntryInput {
  /** `PaymentAllocation.id`. Keys the entry - {@link depositApplicationPeriodKey}. */
  allocationId: string
  /**
   * `PaymentTransaction.id`. Every line's `sourceId`, so the reclass is found
   * by the same reads that find the receipt entry.
   */
  transactionId: string
  /** Integer minor units, > 0. What moves out of the liability. */
  amountMinor: number
  /**
   * `YYYY-MM-DD`. The ALLOCATION's own date, never the deposit's receipt date.
   * The money changed character on the day it was applied.
   */
  appliedAt: string
  /** The invoice number the deposit was applied to. Memo only. */
  invoiceNumber?: string | null
  memo?: string
}

export interface BuiltDepositApplicationEntry {
  entry: BuiltEntry
  periodKey: string
  amountMinor: number
}

/**
 * Build the reclass entry for one deposit application.
 *
 * @throws {UnprocessableEntityError} on a blank allocation or transaction id,
 *   or an amount that is not a positive whole number of minor units.
 */
export function buildDepositApplicationEntry(
  input: BuildDepositApplicationEntryInput
): BuiltDepositApplicationEntry {
  const { allocationId, amountMinor, appliedAt, invoiceNumber, memo } = input
  const transactionId = input.transactionId.trim()

  if (!transactionId) {
    throw new UnprocessableEntityError(
      'A deposit application entry needs the payment transaction it reclasses',
      { allocationId }
    )
  }
  if (!Number.isFinite(amountMinor) || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new UnprocessableEntityError(
      `Deposit application ${allocationId} is ${String(amountMinor)}. A reclass moves a positive ` +
        'whole number of minor units - there is nothing to move otherwise.',
      { allocationId, transactionId, amountMinor: String(amountMinor) }
    )
  }

  const periodKey = depositApplicationPeriodKey(allocationId)
  const lineMemo =
    memo ??
    (invoiceNumber
      ? `Customer deposit applied to ${invoiceNumber}`
      : 'Customer deposit applied to an invoice')
  const source = { sourceType: DEPOSIT_APPLICATION_SOURCE_TYPE, sourceId: transactionId }

  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
      direction: 'debit',
      amount: amountMinor,
      memo: lineMemo,
      sortOrder: 0,
    },
    {
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'credit',
      amount: amountMinor,
      memo: lineMemo,
      sortOrder: 1,
    },
  ]

  return {
    entry: buildEntry({
      postingType: DEPOSIT_APPLICATION_POSTING_TYPE,
      periodKey,
      txnDate: appliedAt,
      lines,
    }),
    periodKey,
    amountMinor,
  }
}

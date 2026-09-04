// packages/lib/src/money/bank-deposits/types.ts

/**
 * The shapes the bank-deposit reads return and the writes accept
 * (plans/accounting/tasks/06-deposit-grouping.md).
 *
 * Every money figure is INTEGER MINOR UNITS. `FieldValue.valueNumber` is a
 * double, so each read converts once, here, and every consumer downstream of
 * this file is working in integers.
 */

import type { PostResult } from '../../postings/types'
import type { RecordId } from '../../resources/resource-id'
import type { BankDepositStatus } from './client'

/** One received payment that has not been banked yet - a row in the left list. */
export interface UndepositedPaymentRow {
  /** `EntityInstance.id` of the `payment` record. */
  paymentId: string
  recordId: RecordId
  /** Integer minor units. Always > 0 for a row that can be banked. */
  amountMinor: number
  /** `YYYY-MM-DD`, the date the payment was received. Null when unset. */
  date: string | null
  /** `PaymentMethod` - `cash`, `check`, ... Null when unset. */
  method: string | null
  /** Cheque number, card last four, whatever the payer wrote. */
  reference: string | null
  /** The invoice this payment applies to, for the "who paid" column. */
  invoiceInstanceId: string | null
  /** The invoice's display name, so the list does not have to resolve it. */
  invoiceName: string | null
  /** ISO 4217, off the `PaymentTransaction` row. Null when the row is missing. */
  currency: string | null
}

/** One recorded bank deposit. */
export interface BankDepositRecord {
  /** `EntityInstance.id` of the `bank_deposit` record. */
  depositId: string
  recordId: RecordId
  /** `DEP-0001`. Issued by the create hook and never edited. */
  number: string | null
  /** `YYYY-MM-DD`. THE accounting date of the posting. */
  depositDate: string | null
  /** GL account CODE the money lands in. */
  bankAccountCode: string | null
  reference: string | null
  status: BankDepositStatus
  /** Integer minor units. Equals the sum of {@link BankDepositDetail.payments}. */
  totalMinor: number
  /** The matched bank statement line. Non-null means the deposit is frozen. */
  bankTransactionId: string | null
  clearedAt: Date | null
  reconciledAt: Date | null
  /** The `GlPosting` row this deposit produced, or null when it never posted. */
  glPostingId: string | null
  createdAt: Date
}

/** One deposit with the payments it grouped. */
export interface BankDepositDetail extends BankDepositRecord {
  payments: UndepositedPaymentRow[]
}

/** Filters for {@link listUndepositedPayments}. All narrow in SQL. */
export interface ListUndepositedFilters {
  /** One `PaymentMethod`. Absent means every method routed to undeposited funds. */
  method?: string
  /** `YYYY-MM-DD` inclusive lower bound on the payment date. */
  from?: string
  /** `YYYY-MM-DD` inclusive upper bound on the payment date. */
  to?: string
  limit?: number
  offset?: number
}

/** Filters for {@link listBankDeposits}. */
export interface ListBankDepositsFilters {
  status?: BankDepositStatus
  limit?: number
  offset?: number
}

/** Input for {@link createBankDeposit}. */
export interface CreateBankDepositInput {
  /** `EntityInstance.id` of every payment being banked. At least one. */
  paymentIds: string[]
  /** `YYYY-MM-DD`. The date the deposit hits the bank, and the posting's date. */
  depositDate: string
  /** GL account CODE from the org's own chart. Resolved by the poster, not here. */
  bankAccountCode: string
  reference?: string
}

/**
 * What {@link createBankDeposit} returns: the record, and what the ledger did
 * with it.
 *
 * The two are separate because `postEntry` never throws - `not_connected` is a
 * first-class success and a locked period is a refusal, not an error - so the
 * caller needs both halves to render the right thing.
 */
export interface CreateBankDepositResult {
  deposit: BankDepositDetail
  post: PostResult
}

/** Input for {@link clearBankDeposit}. */
export interface ClearBankDepositInput {
  depositId: string
  /** The bank statement line this deposit matched. */
  bankTransactionId: string
  /** When the bank credited it. Defaults to now. */
  clearedAt?: Date
}

/** Input for {@link updateBankDeposit}. Every field is optional. */
export interface UpdateBankDepositInput {
  depositId: string
  depositDate?: string
  bankAccountCode?: string
  reference?: string
}

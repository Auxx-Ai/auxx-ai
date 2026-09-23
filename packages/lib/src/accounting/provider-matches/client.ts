// packages/lib/src/accounting/provider-matches/client.ts
// The vocabulary of a provider-authored entry matched to a record of ours (brief 102).

import { type MatchState, PROCESSOR_MATCH_STATES } from '../money/payouts/match-reasons'
import {
  BILL_PAYMENT_TXN_TYPES,
  PURCHASE_TXN_TYPES,
} from '../providers/quickbooks/transaction-links'

export type { MatchState }

/** The same four states a processor item takes. */
export const MATCH_STATES = PROCESSOR_MATCH_STATES

/** The report labels the matcher reads; every other provider entry stays their `provider_sync`. */
export const MATCHABLE_PROVIDER_TXN_TYPES = [
  'Payment',
  'Deposit',
  ...BILL_PAYMENT_TXN_TYPES,
  ...PURCHASE_TXN_TYPES,
] as const

/** 🛑 Mirrored as free text on `ProviderLedgerEntry.matchReason`. Change both together. */
export const PROVIDER_MATCH_REASONS = [
  /** Their payment on an invoice of ours with no receipt of ours: recorded here, posted there. */
  'adopted',
  /** A receipt of ours for the same invoice and amount, not sent yet: Accept keeps theirs. */
  'ours_unsent',
  /** A receipt or payout of ours already sent: Accept asks the accountant to delete theirs. */
  'duplicate_sent',
  /** A deposit coded to a rail's clearing account with no payout of ours yet; re-assessed. */
  'no_payout',
  /** Their expense names a vendor of ours but nothing of ours fits it yet; re-assessed. */
  'no_candidate',
  /** Their expense pays an open bill of ours: Accept asks for it to be linked to the bill there. */
  'pays_bill',
  /** More than one of ours fits. */
  'ambiguous',
  /** Their payment names our invoice or bill but cannot be recorded against it (over its balance). */
  'cannot_adopt',
  /** Their payment names the invoice we sent for an order's shipment; orders are not matched yet. */
  'order_invoice',
  /** Names nothing of ours: theirs alone, and their `provider_sync` is the whole story. */
  'not_ours',
  /** A person rejected the suggestion; never re-suggested. */
  'dismissed',
] as const

export type ProviderMatchReason = (typeof PROVIDER_MATCH_REASONS)[number]

/**
 * What `matchedId` names. A payout is its `payout` record, the subject its posting carries;
 * `invoice` only on an `unmatchable` payment that names our invoice; `vendor_bill` on the same
 * for a bill payment, and on a `pays_bill` suggestion.
 */
export type ProviderMatchKind = 'money_transaction' | 'payout' | 'invoice' | 'vendor_bill'

/** One provider-authored entry as the worklist and the drawers show it. */
export interface ProviderMatchRow {
  /** `ProviderLedgerEntry.id`. */
  id: string
  bookId: string
  /** The report label verbatim: one of `MATCHABLE_PROVIDER_TXN_TYPES`. */
  providerTxnType: string
  providerTxnId: string
  docNumber: string | null
  /** `YYYY-MM-DD`. */
  txnDate: string
  /** The debit total of its lines. */
  amountMinor: number
  currency: string
  /** Our contact for the provider customer its lines name, when exactly one resolves. */
  customerName: string | null
  matchState: MatchState | null
  matchReason: ProviderMatchReason
  matchedKind: ProviderMatchKind | null
  matchedId: string | null
  /** Our side of the match; null when `matchedId` is null or no longer resolves. */
  matched: ProviderMatchSide | null
  matchedBy: string | null
  matchedAt: Date | null
}

export interface ProviderMatchSide {
  label: string
  date: string | null
  amountMinor: number | null
  /** The one invoice a receipt is applied to, or the invoice itself. */
  invoiceInstanceId: string | null
  /** The one vendor bill a vendor payment is applied to, or the bill itself. */
  vendorBillInstanceId: string | null
  /** A payout's `MoneyTransfer` id, the one the Payouts drawer opens on; null for other kinds. */
  payoutEvidenceId: string | null
}

export interface ProviderMatchCounts {
  suggested: number
  pending: number
  unmatchable: number
}

export interface PayoutProviderSide {
  /** Our payout's live posting's export batch, or null when none holds it. */
  deposit: {
    batchState: string
    providerObjectId: string | null
    objectType: string
    bookId: string
    sentAt: Date | null
    /** The provider's cleared flag on its bank line verbatim (QuickBooks `R` / `C`), or null. */
    cleared: string | null
  } | null
  /** Provider entries suggested as, or matched to, this payout. */
  duplicates: ProviderMatchRow[]
}

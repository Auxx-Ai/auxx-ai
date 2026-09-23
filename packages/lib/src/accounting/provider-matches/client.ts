// packages/lib/src/accounting/provider-matches/client.ts
// The vocabulary of a provider-authored entry matched to a record of ours (brief 102).

import type { MatchState } from '../money/payouts/match-reasons'

export type { MatchState }

/** The report labels the matcher reads; every other provider entry stays their `provider_sync`. */
export const MATCHABLE_PROVIDER_TXN_TYPES = ['Payment', 'Deposit'] as const

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
  /** More than one of ours fits. */
  'ambiguous',
  /** Their payment names our invoice but cannot be recorded against it (over its balance). */
  'cannot_adopt',
  /** Their payment names the invoice we sent for an order's shipment; orders are not matched yet. */
  'order_invoice',
  /** Names nothing of ours: theirs alone, and their `provider_sync` is the whole story. */
  'not_ours',
  /** A person rejected the suggestion; never re-suggested. */
  'dismissed',
] as const

export type ProviderMatchReason = (typeof PROVIDER_MATCH_REASONS)[number]

/** What `matchedId` names. A payout is its `payout` record, the subject its posting carries. */
export type ProviderMatchKind = 'money_transaction' | 'payout'

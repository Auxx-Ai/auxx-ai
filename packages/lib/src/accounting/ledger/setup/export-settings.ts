// packages/lib/src/accounting/ledger/setup/export-settings.ts
//
// TARGET §3: which grain postings leave in, and whether a person releases them.
// PURE - on the `client.ts` surface. The settings read lives in
// `read-export-settings.ts`.

import type { PostingType } from '../types'

/**
 * The category every posting carries as `GlPosting.avenue`: the provider-object
 * family it leaves as, the lane its `autoPost` / `autoSend` / `summaryGrain`
 * switches key on, and the one vocabulary every Outbox tab filters by.
 * Mirrors TARGET §3's provider-object table and §5's Provider object column.
 */
export const EXPORT_AVENUES = [
  'fulfillment',
  'invoice',
  'receipt',
  'refund',
  'creditMemo',
  'expenseBill',
  'vendorPayment',
  'vendorCredit',
  'payout',
  'bankDeposit',
  'inventory',
  'journal',
] as const

export type ExportAvenue = (typeof EXPORT_AVENUES)[number]

/** The avenues with a draft step - `accounting.autoPost.<avenue>` exists for these alone. */
export const AUTO_POST_AVENUES = [
  'fulfillment',
  'invoice',
  'receipt',
  'refund',
  'creditMemo',
  'expenseBill',
  'vendorPayment',
  'vendorCredit',
] as const

export type AutoPostAvenue = (typeof AUTO_POST_AVENUES)[number]

/** The avenues `accounting.summaryGrain.*` governs. Payouts, bank deposits and journals have no grain - one object each. */
export const SUMMARY_GRAIN_AVENUES = [
  'fulfillment',
  'invoice',
  'receipt',
  'refund',
  'creditMemo',
  'expenseBill',
  'vendorPayment',
  'vendorCredit',
  'inventory',
] as const

export type SummaryGrainAvenue = (typeof SUMMARY_GRAIN_AVENUES)[number]

/** `payout` buckets by `GlPosting.payoutId`; a posting with none falls into its day (91 D9). */
export const SUMMARY_GRAINS = ['day', 'month', 'payout'] as const

export type SummaryGrain = (typeof SUMMARY_GRAINS)[number]

export function isSummaryGrain(value: unknown): value is SummaryGrain {
  return (SUMMARY_GRAINS as readonly unknown[]).includes(value)
}

export function isSummaryGrainAvenue(avenue: ExportAvenue): avenue is SummaryGrainAvenue {
  return (SUMMARY_GRAIN_AVENUES as readonly string[]).includes(avenue)
}

/**
 * Which avenue a posting type belongs to, or `null` when it is never exported.
 * Applied once, when the row is written (`insert-posting.ts`); every read
 * groups and filters on the stored `GlPosting.avenue` column instead.
 *
 * No `default` case: the switch must stay exhaustive over `PostingType` so a
 * posting type added later fails to compile here rather than silently landing
 * in no avenue at all - `export-settings.test.ts` also checks it is total over
 * `POSTING_TYPES` at runtime.
 */
export function avenueOfPostingType(postingType: PostingType): ExportAvenue | null {
  switch (postingType) {
    case 'fulfillment':
      return 'fulfillment'
    case 'invoice_issued':
      return 'invoice'
    case 'payment':
      return 'receipt'
    case 'refund':
      return 'refund'
    case 'credit_memo':
      return 'creditMemo'
    case 'vendor_bill':
      return 'expenseBill'
    // Money with a vendor, either direction (TARGET §5: a Bill Payment, and a
    // Deposit against the vendor), the way `receipt` holds both customer entries.
    case 'vendor_payment':
    case 'vendor_refund':
      return 'vendorPayment'
    case 'vendor_credit':
      return 'vendorCredit'
    case 'payout':
      return 'payout'
    case 'bank_deposit':
      return 'bankDeposit'
    // The stock subledger's entries: a movement document, and the landed-cost
    // accrual it clears. Journal-shaped at the provider, but their own lane -
    // they are most of what leaves, and nobody wants them buried under "journal".
    case 'inventory_movement':
    case 'landed_cost_clear':
      return 'inventory'
    // No native object (TARGET §3's table): a journal entry.
    case 'write_off':
    case 'manual_journal':
    case 'recurring_journal':
    case 'month_end_deferral':
    case 'month_end_reversal':
      return 'journal'
    // Never exported: an opening entry has no provider counterpart, a
    // provider-authored entry must never be pushed back at the provider, and a
    // coded bank line is already on the provider's own bank feed.
    case 'opening_balance':
    case 'provider_sync':
    case 'bank_transaction':
    // No writer since 91 §4.3; TODO(91 S3): drops with the enum value.
    case 'deposit_application':
      return null
  }
}

export interface ExportSettings {
  mode: 'transaction' | 'summary'
  /** `YYYY-MM-DD`, or `null` when unset - nothing dated before it is ever batched. */
  cutover: string | null
  autoSend: Record<ExportAvenue, boolean>
  summaryGrain: Record<SummaryGrainAvenue, SummaryGrain>
}

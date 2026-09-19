// packages/lib/src/accounting/ledger/setup/export-settings.ts
//
// TARGET §3: which grain postings leave in, and whether a person releases them.
// PURE - on the `client.ts` surface. The settings read lives in
// `read-export-settings.ts`.

import type { PostingType } from '../types'

/** Every avenue the export batch groups postings by. Mirrors TARGET §3's provider-object table. */
export const EXPORT_AVENUES = [
  'fulfillment',
  'receipt',
  'refund',
  'creditMemo',
  'invoice',
  'expenseBill',
  'payout',
  'bankDeposit',
  'journal',
] as const

export type ExportAvenue = (typeof EXPORT_AVENUES)[number]

/** The avenues `accounting.summaryGrain.*` governs. Payouts, bank deposits and journals have no grain - one object each. */
export const SUMMARY_GRAIN_AVENUES = [
  'fulfillment',
  'receipt',
  'refund',
  'creditMemo',
  'invoice',
  'expenseBill',
] as const

export type SummaryGrainAvenue = (typeof SUMMARY_GRAIN_AVENUES)[number]

export type SummaryGrain = 'day' | 'month'

/**
 * Which export avenue a posting type rolls up under, or `null` when it is never
 * exported. The inverse of the writers MIGRATION.md step 1b's table names.
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
    case 'payment':
      return 'receipt'
    case 'refund':
      return 'refund'
    case 'credit_memo':
      return 'creditMemo'
    case 'invoice_issued':
    case 'write_off':
      return 'invoice'
    case 'vendor_bill':
    // A vendor credit rides the buy-side avenue: its auto-post mode is the
    // expense bill's, and no new avenue was added for it (71 U7, decision 2).
    case 'vendor_credit':
      return 'expenseBill'
    case 'payout':
      return 'payout'
    case 'bank_deposit':
      return 'bankDeposit'
    // No native object (TARGET §3's table): a journal entry.
    case 'manual_journal':
    case 'recurring_journal':
    case 'inventory_movement':
    case 'month_end_deferral':
    case 'month_end_reversal':
      return 'journal'
    // Rides along with the payment it applies against - TARGET §5: "part of the Payment".
    case 'deposit_application':
      return 'receipt'
    // Never exported: an opening entry has no provider counterpart, a
    // provider-authored entry must never be pushed back at the provider, and a
    // coded bank line is already on the provider's own bank feed.
    case 'opening_balance':
    case 'provider_sync':
    case 'bank_transaction':
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

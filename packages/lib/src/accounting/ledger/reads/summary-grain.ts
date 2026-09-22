// packages/lib/src/accounting/ledger/reads/summary-grain.ts
//
// PURE. The grain-bucket key TARGET §6's summary read groups by, shared with the
// UI so a settings page can preview a bucket without a round trip.

import type { SummaryGrain } from '../setup/export-settings'

/**
 * `'YYYY-MM-DD'` for `'day'`, `'YYYY-MM'` for `'month'`, the payout id for `'payout'` - or the
 * day when the posting has none, so nothing waits on a settlement (91 D9). `txnDate` is book-zone.
 */
export function summaryGrainKey(
  txnDate: string,
  grain: SummaryGrain,
  payoutId?: string | null
): string {
  if (grain === 'month') return txnDate.slice(0, 7)
  if (grain === 'payout' && payoutId) return payoutId
  return txnDate
}

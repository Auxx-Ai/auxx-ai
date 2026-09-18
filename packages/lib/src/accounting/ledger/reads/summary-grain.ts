// packages/lib/src/accounting/ledger/reads/summary-grain.ts
//
// PURE. The grain-bucket key TARGET §6's summary read groups by, shared with the
// UI so a settings page can preview a bucket without a round trip.

/** `'YYYY-MM-DD'` for `'day'`, `'YYYY-MM'` for `'month'`. `txnDate` is already a book-zone date. */
export function summaryGrainKey(txnDate: string, grain: 'day' | 'month'): string {
  return grain === 'month' ? txnDate.slice(0, 7) : txnDate
}

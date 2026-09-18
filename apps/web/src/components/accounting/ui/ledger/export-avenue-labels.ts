// apps/web/src/components/accounting/ui/ledger/export-avenue-labels.ts
//
// Display copy for `ExportAvenue` (TARGET §3's provider-object table), shared by
// the outbox, the ledger summary view and the Posting settings page's
// per-avenue export row - nowhere else names these, so there is one spelling.

import type { ExportAvenue } from '@auxx/lib/accounting/ledger/client'

export const EXPORT_AVENUE_LABEL: Record<ExportAvenue, string> = {
  fulfillment: 'Fulfillment',
  receipt: 'Customer receipt',
  refund: 'Refund',
  creditMemo: 'Credit memo',
  invoice: 'Invoice',
  expenseBill: 'Expense bill',
  payout: 'Payout',
  bankDeposit: 'Bank deposit',
  journal: 'Journal entry',
}

/**
 * `ExportBatchRow.avenue` (and `LedgerSummaryRow.avenue`) come back as plain
 * `string` off the DTO rather than the narrower `ExportAvenue` - reads that
 * never validate the value against the union it was written from. Falls back
 * to the raw string for one this deploy's catalogue does not (yet) name,
 * rather than throwing over a display label.
 */
export function exportAvenueLabel(avenue: string): string {
  return EXPORT_AVENUE_LABEL[avenue as ExportAvenue] ?? avenue
}

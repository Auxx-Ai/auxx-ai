// packages/lib/src/postings/export/client.ts
// Client-safe surface of the export batch: the state vocabulary and its prose.
// No `'use client'` - server code imports these too (docs/lib-module-guide.md §7).

/** The batch lifecycle, mirroring `EXPORT_BATCH_STATES` on the Drizzle table. */
export const EXPORT_BATCH_STATES = ['ready', 'sending', 'sent', 'failed', 'withdrawn'] as const
export type ExportBatchState = (typeof EXPORT_BATCH_STATES)[number]

/** The queue's tabs, in the order they render. `withdrawn` is history, not a tab. */
export const EXPORT_BATCH_TABS = ['ready', 'sending', 'sent', 'failed'] as const
export type ExportBatchTab = (typeof EXPORT_BATCH_TABS)[number]

const LABELS: Record<ExportBatchState, string> = {
  ready: 'Ready',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  withdrawn: 'Rolled back',
}

export function exportBatchStateLabel(state: ExportBatchState): string {
  return LABELS[state]
}

/** One line a row can render under its badge. Null when the state speaks for itself. */
export function exportBatchStateHint(state: ExportBatchState, autoSend: boolean): string | null {
  if (state === 'ready') return autoSend ? 'Waiting for the next send' : 'Held until released'
  if (state === 'failed') return 'The provider refused this batch'
  if (state === 'withdrawn') return 'Removed from the provider; rebuilt on the next build'
  return null
}

/** Plan 67 §1's mapping table, in the words the sync queue shows for `ExportBatchRow.objectType`. */
const OBJECT_TYPE_LABELS: Record<string, string> = {
  journal: 'Journal entry',
  sales_receipt: 'Sales receipt',
  invoice: 'Invoice',
  payment: 'Payment',
  credit_memo: 'Credit memo',
  refund_receipt: 'Refund receipt',
  deposit: 'Deposit',
  bill: 'Bill',
}

/** Unknown `objectType` renders as the raw string - never a refusal on the queue row. */
export function exportObjectTypeLabel(objectType: string): string {
  return OBJECT_TYPE_LABELS[objectType] ?? objectType
}

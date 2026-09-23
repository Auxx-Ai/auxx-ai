// packages/lib/src/accounting/export/client.ts
// Client-safe surface of the export batch: the state vocabulary and its prose.
// No `'use client'` - server code imports these too (docs/lib-module-guide.md §7).

import { EXPORT_AVENUES, type ExportAvenue } from '../ledger/setup/export-settings'

/** The batch lifecycle, mirroring `EXPORT_BATCH_STATES` on the Drizzle table. */
export const EXPORT_BATCH_STATES = ['ready', 'sending', 'sent', 'failed', 'withdrawn'] as const
export type ExportBatchState = (typeof EXPORT_BATCH_STATES)[number]

/** The adapter's verdict on a refusal, mirrored on `ExportBatch.failureClass` (89 D1). */
export const EXPORT_FAILURE_CLASSES = ['configuration', 'data', 'transport'] as const
export type ExportFailureClass = (typeof EXPORT_FAILURE_CLASSES)[number]

/**
 * One piece of work behind a configuration refusal; both keys land on the same
 * account's picker. Shape duplicated on `ExportBatch.failureItems` in the schema.
 */
export interface ExportFailureItem {
  key: 'unmapped_account' | 'invalid_mapping'
  /** The `gl_account` id the remedy targets. */
  ref: string
  /** `accountLabel(account)` - what the row prints. */
  label: string
  /** One sentence, in `CloseBlockerItem`'s shape so `EntryBlockers` can render it. */
  remedy: string
}

/** One line under the Failed badge, by class. Null when the class is unknown. */
export function exportFailureClassHint(failureClass: ExportFailureClass | null): string | null {
  if (failureClass === 'configuration') return 'A setup problem'
  if (failureClass === 'data') return 'The provider refused the data'
  if (failureClass === 'transport') return 'The provider was unreachable'
  return null
}

/**
 * The export tabs, in the order they render. `withdrawn` is history, not a tab,
 * and neither is `sending` (75-D6) - a momentary state is not a place to stand,
 * so a sending batch stays listed under Ready and spins there.
 */
export const EXPORT_BATCH_TABS = ['ready', 'sent', 'failed'] as const
export type ExportBatchTab = (typeof EXPORT_BATCH_TABS)[number]

/** How a batch tab's rows are grouped (`?group=`); absent is a flat list, newest built first. */
export const OUTBOX_GROUP_BYS = ['day'] as const
export type OutboxGroupBy = (typeof OUTBOX_GROUP_BYS)[number]

/** The direction of a batch tab's order (`?order=`); `desc` when absent. */
export const OUTBOX_ORDERS = ['asc', 'desc'] as const
export type OutboxOrder = (typeof OUTBOX_ORDERS)[number]

/** What a batch tab's row is (`?view=`): the period bucket, or the posting (95 §3.1). */
export const OUTBOX_VIEWS = ['summary', 'transaction'] as const
export type OutboxView = (typeof OUTBOX_VIEWS)[number]

/**
 * The Outbox's tabs: the movements the ledger refused, then the export states.
 * `blocked` is not an `ExportBatchState` - it has no posting at all (75-D1).
 */
export const OUTBOX_TABS = ['blocked', ...EXPORT_BATCH_TABS] as const
export type OutboxTab = (typeof OUTBOX_TABS)[number]

export function isExportBatchTab(tab: OutboxTab): tab is ExportBatchTab {
  return tab !== 'blocked'
}

/** `?tab=` values a pasted link may still carry - tabs that no longer render included. */
export const OUTBOX_TAB_PARAMS = [...OUTBOX_TABS, 'sending'] as const

/** A link written before 75-D6 dropped the Sending tab lands on Ready, not on an empty strip. */
export function parseOutboxTab(value: string | null | undefined): OutboxTab | null {
  if (!value) return null
  return (OUTBOX_TABS as readonly string[]).includes(value) ? (value as OutboxTab) : 'ready'
}

/** Which batch states a tab lists. Ready holds `sending` too (75-D6). */
export function exportBatchTabStates(tab: ExportBatchTab): ExportBatchState[] {
  return tab === 'ready' ? ['ready', 'sending'] : [tab]
}

export function exportBatchTabAdmits(tab: ExportBatchTab, state: ExportBatchState): boolean {
  return exportBatchTabStates(tab).includes(state)
}

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

/** Plan 67 §1's mapping table, in the words the outbox shows for `ExportBatchRow.objectType`. */
const OBJECT_TYPE_LABELS: Record<string, string> = {
  journal: 'Journal entry',
  invoice: 'Invoice',
  payment: 'Payment',
  credit_memo: 'Credit memo',
  refund_receipt: 'Refund receipt',
  deposit: 'Deposit',
  bill: 'Bill',
  vendor_credit: 'Vendor credit',
}

/** Unknown `objectType` renders as the raw string - never a refusal on the queue row. */
export function exportObjectTypeLabel(objectType: string): string {
  return OBJECT_TYPE_LABELS[objectType] ?? objectType
}

/** What one summary batch is keyed on - `ExportBatch_grain_key` without the book. */
export interface UnbuiltGroupKey {
  avenue: ExportAvenue
  grainKey: string
  storeId: string | null
  railId: string | null
  currency: string
}

/** A summary row's status (95 §3.2): its live batch's state, split by whether postings landed since. */
export const SUMMARY_ROW_STATUSES = [
  'not_sent',
  'ready',
  'ready_new',
  'sending',
  'sent',
  'sent_new',
  'failed',
] as const
export type SummaryRowStatus = (typeof SUMMARY_ROW_STATUSES)[number]

/** `newCount` is the bucket's postings the live batch does not hold. */
export function summaryRowStatus(
  batchState: ExportBatchState | null,
  newCount: number
): SummaryRowStatus {
  if (!batchState || batchState === 'withdrawn') return 'not_sent'
  if (batchState === 'ready') return newCount > 0 ? 'ready_new' : 'ready'
  if (batchState === 'sent') return newCount > 0 ? 'sent_new' : 'sent'
  return batchState
}

/** The group key as one string, stable across reads so a row can be tracked and matched. */
export function unbuiltGroupKeyString(group: UnbuiltGroupKey): string {
  return [group.avenue, group.grainKey, group.storeId ?? '', group.railId ?? '', group.currency]
    .join(' ')
    .trim()
}

/** The inverse of `unbuiltGroupKeyString`, for a key that arrived in a URL; null when malformed. */
export function parseUnbuiltGroupKey(key: string): UnbuiltGroupKey | null {
  const [avenue, grainKey, storeId, railId, currency, ...rest] = key.split(' ')
  if (rest.length || !grainKey || !currency) return null
  if (!(EXPORT_AVENUES as readonly string[]).includes(avenue ?? '')) return null
  return {
    avenue: avenue as ExportAvenue,
    grainKey,
    storeId: storeId || null,
    railId: railId || null,
    currency,
  }
}

/**
 * Whether Reverse is offered: only once the provider holds the entry, or for one that never
 * goes there. A reversal of an entry still in Ready would reach the provider alone.
 */
export function canReverseExportedPosting(input: {
  avenue: ExportAvenue | null
  exportState: ExportBatchState | null
}): boolean {
  return input.avenue === null || input.exportState === 'sent'
}

// packages/lib/src/accounting/export/client.ts
// Client-safe surface of the export batch: the state vocabulary and its prose.
// No `'use client'` - server code imports these too (docs/lib-module-guide.md §7).

import type { ExportAvenue } from '../ledger/setup/export-settings'

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

/**
 * The Outbox's tabs: the ledger's own drafts, the movements the ledger refused,
 * then the export states. Neither `drafts` nor `blocked` is an
 * `ExportBatchState` - one has no batch yet and the other has no posting at
 * all, which is the point of the two leading the strip (75-D1).
 */
export const OUTBOX_TABS = ['drafts', 'blocked', ...EXPORT_BATCH_TABS] as const
export type OutboxTab = (typeof OUTBOX_TABS)[number]

export function isExportBatchTab(tab: OutboxTab): tab is ExportBatchTab {
  return tab !== 'drafts' && tab !== 'blocked'
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

/** The group key as one string, stable across reads so a row can be tracked and matched. */
export function unbuiltGroupKeyString(group: UnbuiltGroupKey): string {
  return [group.avenue, group.grainKey, group.storeId ?? '', group.railId ?? '', group.currency]
    .join(' ')
    .trim()
}

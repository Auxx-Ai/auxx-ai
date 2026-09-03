// packages/lib/src/resources/hooks/invoice-hooks.ts

import {
  createLifecycleStatusGuard,
  INVOICE_ACTION_STATUS_MESSAGE,
  INVOICE_ACTION_STATUSES,
} from './lifecycle-status-guard'
import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Number the invoice on create. Mirrors autoGenerateQuoteNumber, except that a
 * data connector may bring the source's own invoice number (QuickBooks), which
 * is kept; invoice_number has creatable:false/updatable:false, so this hook is
 * the only writer when nothing is supplied ("theirs if they bring one, otherwise
 * ours", plans/money/tasks/39-shopify-first-sync-followups.md section 6.5).
 */
const autoGenerateInvoiceNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'invoice')

/**
 * Guard: `sent`, `partially_paid`, `paid`, and `void` may only be set by the invoice actions
 * (money.markInvoiceSent / money.recordPayment (via the ledger sync) / money.voidInvoice —
 * money MI1 build spec §F.2) — those transitions carry side effects (send machinery,
 * ledger-derived mirrors, unstamping sources) that a manual write (drawer/kanban drag/Kopilot)
 * would skip. The sanctioned writers write via `FieldValueService` (the mirror-service
 * precedent — bypasses this system pre-hook entirely), so this guard never sees those
 * sanctioned writes. `draft` stays freely editable — the edit-sent-back-to-draft flow writes
 * plain status `'draft'` after a `useConfirm`, and un-void (manual `draft` write) both flow
 * through it.
 *
 * ⚠️ **This chain is coverage, not enforcement.** It runs for `record.create`/`record.update`,
 * the CSV importer and the SDK — NOT for `fieldValue.set`, which is how the drawer, the grid's
 * inline edit and a kanban drag write. Its field-chain twin
 * (`field-hooks/pre/lifecycle-status-guard.ts`) is what stops a human typing `paid` with no
 * payment behind it, and the two share their value set and message through the constants they
 * both import.
 */
const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: INVOICE_ACTION_STATUSES,
  message: INVOICE_ACTION_STATUS_MESSAGE,
})

export const INVOICE_HOOKS: SystemHookRegistry = {
  invoice_number: [autoGenerateInvoiceNumber],
  invoice_status: [rejectManualLifecycleStatus],
}

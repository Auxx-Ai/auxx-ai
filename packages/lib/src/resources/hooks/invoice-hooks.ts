// packages/lib/src/resources/hooks/invoice-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import {
  createLifecycleStatusGuard,
  INVOICE_ACTION_STATUS_MESSAGE,
  INVOICE_ACTION_STATUSES,
} from './lifecycle-status-guard'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the invoice number on create. Mirrors autoGenerateQuoteNumber.
 * invoice_number has creatable:false/updatable:false, so this hook is the ONLY writer.
 */
const autoGenerateInvoiceNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'invoice')
  return { ...values, [field.id]: recordNumber }
}

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

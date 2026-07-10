// packages/lib/src/resources/hooks/invoice-hooks.ts

import { BadRequestError } from '../../errors'
import { recordNumbering } from '../../records/record-numbering'
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
 */
const rejectManualLifecycleStatus: SystemHook = async ({ operation, field, values }) => {
  if (operation === 'create') return values // creates can't start sent/partially_paid/paid/void (defaultValue 'draft')
  // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const next = Array.isArray(raw) ? raw[0] : raw
  if (next === 'sent' || next === 'partially_paid' || next === 'paid' || next === 'void') {
    throw new BadRequestError(
      'Use the invoice actions (Send / Record payment / Void) to set this status'
    )
  }
  return values
}

export const INVOICE_HOOKS: SystemHookRegistry = {
  invoice_number: [autoGenerateInvoiceNumber],
  invoice_status: [rejectManualLifecycleStatus],
}

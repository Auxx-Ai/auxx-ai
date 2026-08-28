// packages/lib/src/resources/hooks/quote-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import {
  createLifecycleStatusGuard,
  QUOTE_ACTION_STATUS_MESSAGE,
  QUOTE_ACTION_STATUSES,
} from './lifecycle-status-guard'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the quote number on create. Mirrors autoGenerateServiceRequestNumber.
 * quote_number has creatable:false/updatable:false, so this hook is the ONLY writer.
 */
const autoGenerateQuoteNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'quote')
  return { ...values, [field.id]: recordNumber }
}

/**
 * Guard: `sent` and `approved` may only be set by the quote actions (money.markQuoteSent /
 * money.approveQuote — money MQ1 build spec §F.3) — those transitions mirror onto the linked
 * request (request `service_request_status` → `quoted`/`approved`), and a manual write
 * (drawer/kanban drag) would skip the mirror. The lifecycle mutations write via
 * FieldValueService (the mirror-service precedent — bypasses system pre-hooks), so this guard
 * never sees the sanctioned write. `draft`/`declined`/`canceled` stay freely editable — the
 * edit-sent-back-to-draft flow writes plain status `'draft'` after a `useConfirm`, which this
 * guard also allows through.
 *
 * ⚠️ **This chain is coverage, not enforcement.** It runs for `record.create`/`record.update`,
 * the CSV importer and the SDK — NOT for `fieldValue.set`, which is how the drawer, the grid's
 * inline edit and a kanban drag write. Its field-chain twin
 * (`field-hooks/pre/lifecycle-status-guard.ts`) is what stops a human typing `sent`, and the
 * two share their value set and message through the constants they both import.
 */
const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: QUOTE_ACTION_STATUSES,
  message: QUOTE_ACTION_STATUS_MESSAGE,
})

export const QUOTE_HOOKS: SystemHookRegistry = {
  quote_number: [autoGenerateQuoteNumber],
  quote_status: [rejectManualLifecycleStatus],
}

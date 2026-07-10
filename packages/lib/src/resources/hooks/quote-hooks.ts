// packages/lib/src/resources/hooks/quote-hooks.ts

import { BadRequestError } from '../../errors'
import { recordNumbering } from '../../records/record-numbering'
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
 */
const rejectManualLifecycleStatus: SystemHook = async ({ operation, field, values }) => {
  if (operation === 'create') return values // creates can't start sent/approved (defaultValue 'draft')
  // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const next = Array.isArray(raw) ? raw[0] : raw
  if (next === 'sent' || next === 'approved') {
    throw new BadRequestError('Use the quote actions (Send / Mark approved) to set this status')
  }
  return values
}

export const QUOTE_HOOKS: SystemHookRegistry = {
  quote_number: [autoGenerateQuoteNumber],
  quote_status: [rejectManualLifecycleStatus],
}

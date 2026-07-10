// packages/lib/src/resources/hooks/service-request-hooks.ts

import { BadRequestError } from '../../errors'
import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the service request number on create. Mirrors autoGenerateWorkOrderNumber.
 * service_request_number has creatable:false/updatable:false, so this hook is the ONLY writer.
 */
const autoGenerateServiceRequestNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'service_request')
  return { ...values, [field.id]: recordNumber }
}

/**
 * Guard: `converted` may only be set by convertRequestToWorkOrder (04-ui.md §3 decision,
 * 2026-07-09) — it means "a work order exists", and a manual write (kanban drag to the
 * Converted column, panel edit, Kopilot) would make it a lie. The convert mutation flips the
 * status via FieldValueService (the mirror-service precedent — bypasses system pre-hooks), so
 * this guard never sees the sanctioned write. `lost`/`canceled`/everything else stays freely
 * editable.
 */
const rejectManualConvertedStatus: SystemHook = async ({ operation, field, values }) => {
  if (operation === 'create') return values // creates can't start converted (defaultValue 'new')
  // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const next = Array.isArray(raw) ? raw[0] : raw
  if (next === 'converted') {
    throw new BadRequestError('Use "Convert to job" to convert a request')
  }
  return values
}

export const SERVICE_REQUEST_HOOKS: SystemHookRegistry = {
  service_request_number: [autoGenerateServiceRequestNumber],
  service_request_status: [rejectManualConvertedStatus],
}

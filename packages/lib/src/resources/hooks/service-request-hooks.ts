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
 * Guard: `quoted`, `approved`, and `converted` may only be set by the money quote mutations
 * and convertRequestToWorkOrder (04-ui.md §3 decision, 2026-07-09; money MQ1 build spec §E.3
 * extends the guarded set to the quote-mirrored statuses) — each means "a quote/work order
 * transition already happened", and a manual write (kanban drag, panel edit, Kopilot) would
 * make it a lie. The sanctioned mutations flip status via FieldValueService (the mirror-service
 * precedent — bypasses system pre-hooks), so this guard never sees those writes.
 * `lost`/`canceled`/everything else stays freely editable.
 */
const rejectManualMirroredStatus: SystemHook = async ({ operation, field, values }) => {
  if (operation === 'create') return values // creates can't start mirrored (defaultValue 'new')
  // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const next = Array.isArray(raw) ? raw[0] : raw
  if (next === 'quoted' || next === 'approved' || next === 'converted') {
    throw new BadRequestError('This status is set automatically by quote and convert actions')
  }
  return values
}

export const SERVICE_REQUEST_HOOKS: SystemHookRegistry = {
  service_request_number: [autoGenerateServiceRequestNumber],
  service_request_status: [rejectManualMirroredStatus],
}

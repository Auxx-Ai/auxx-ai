// packages/lib/src/resources/hooks/work-order-hooks.ts

import { BadRequestError } from '../../errors'
import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the work order number on create. Mirrors autoGenerateTicketNumber.
 * work_order_number has creatable:false/updatable:false, so this hook is the ONLY writer.
 */
const autoGenerateWorkOrderNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'work_order')
  return { ...values, [field.id]: recordNumber }
}

/**
 * Guard: `active`/`paused`/`ended` (the recurring engagement lifecycle, dispatch M2c,
 * plans/dispatch/06-recurring-engine.md §4.1) may only be set by the engine mutations
 * (`setRecurrenceRule` / `pauseEngagement` / `resumeEngagement` / `endEngagement`) — those
 * transitions delete/regenerate visit rows and run the mirror, and a manual write (drawer/kanban
 * drag) would skip both. The engine writes via plain `FieldValueService.setValuesForEntity` (the
 * `convertRequestToWorkOrder` precedent — bypasses system pre-hooks), so this guard never sees
 * the sanctioned write. `new`/`scheduled`/`dispatched`/`en_route`/`on_site`/`completed`/`canceled`
 * (the one-off / pre-rule lifecycle) stay freely editable.
 */
const rejectManualEngagementStatus: SystemHook = async ({ operation, field, values }) => {
  // Update values may be keyed by fieldId or systemAttribute, scalar or single-element array.
  const raw = field.id in values ? values[field.id] : values[field.systemAttribute ?? '']
  const next = Array.isArray(raw) ? raw[0] : raw
  if (next === 'active' || next === 'paused' || next === 'ended') {
    throw new BadRequestError(
      'Use the Pause/Resume/End actions to change a recurring engagement status'
    )
  }
  return values
}

export const WORK_ORDER_HOOKS: SystemHookRegistry = {
  work_order_number: [autoGenerateWorkOrderNumber],
  work_order_status: [rejectManualEngagementStatus],
}

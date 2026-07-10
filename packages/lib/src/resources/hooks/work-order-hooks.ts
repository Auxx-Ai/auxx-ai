// packages/lib/src/resources/hooks/work-order-hooks.ts

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

export const WORK_ORDER_HOOKS: SystemHookRegistry = {
  work_order_number: [autoGenerateWorkOrderNumber],
}

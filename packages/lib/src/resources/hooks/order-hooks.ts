// packages/lib/src/resources/hooks/order-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the order number on create. Mirrors autoGenerateInvoiceNumber.
 * order_number has creatable:false/updatable:false, so this hook is the ONLY writer
 * (plans/products/08-order-build.md §5.3/§5.5).
 */
const autoGenerateOrderNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'order')
  return { ...values, [field.id]: recordNumber }
}

/**
 * `order` has no lifecycle guard. Unlike quote and invoice, neither
 * `order_financial_status` nor `order_fulfillment_status` has a sanctioned
 * action that carries side effects — both are plain human-set fields on a
 * document that records what already happened, so there is nothing a manual
 * write would skip.
 */
export const ORDER_HOOKS: SystemHookRegistry = {
  order_number: [autoGenerateOrderNumber],
}

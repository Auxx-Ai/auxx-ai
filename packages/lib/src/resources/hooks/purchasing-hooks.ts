// packages/lib/src/resources/hooks/purchasing-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Auto-generate the purchase order number on create. Mirrors autoGenerateOrderNumber.
 * `purchase_order_number` has creatable:false/updatable:false, so this hook is the ONLY
 * writer (plans/purchasing/01-build-plan.md §4.1).
 */
const autoGeneratePurchaseOrderNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'purchase_order')
  return { ...values, [field.id]: recordNumber }
}

/**
 * Auto-generate OUR reference for a vendor bill on create — RecordSequence scope
 * `vendor_bill`, prefix `BILL`.
 *
 * ⚠️ This is `vendor_bill_internal_number`, NOT `vendor_bill_number`. The latter is the
 * VENDOR's own invoice number keyed from their document: it is human-entered, required,
 * and deliberately has no hook (plans/purchasing/01-build-plan.md §5.1). Two different
 * documents, two different numbers.
 */
const autoGenerateVendorBillInternalNumber: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
}) => {
  if (operation !== 'create') return values
  const { recordNumber } = await recordNumbering.create(organizationId, 'vendor_bill')
  return { ...values, [field.id]: recordNumber }
}

/**
 * `purchase_order` has no lifecycle guard. `purchase_order_status` is a plain human-set
 * field with no sanctioned action carrying side effects, so nothing a manual write skips.
 */
export const PURCHASE_ORDER_HOOKS: SystemHookRegistry = {
  purchase_order_number: [autoGeneratePurchaseOrderNumber],
}

/**
 * `vendor_bill_status` is written by the match hook rather than guarded here — the match
 * recomputes it from the lines on every create/update, so a manual write is overwritten
 * rather than rejected.
 */
export const VENDOR_BILL_HOOKS: SystemHookRegistry = {
  vendor_bill_internal_number: [autoGenerateVendorBillInternalNumber],
}

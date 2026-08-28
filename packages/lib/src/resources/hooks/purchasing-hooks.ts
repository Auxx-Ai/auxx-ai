// packages/lib/src/resources/hooks/purchasing-hooks.ts

import { recordNumbering } from '../../records/record-numbering'
import {
  createLifecycleStatusGuard,
  PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
  PURCHASE_ORDER_ACTION_STATUSES,
} from './lifecycle-status-guard'
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
 * Guard: `issued` may only be set by the Send action (`markPurchaseOrderSent`,
 * plans/purchasing/07-purchase-order-send-and-status.md §3.4/§6.4).
 *
 * ⚠️ This field used to be documented here as *"a plain human-set field with no sanctioned
 * action"*, and that was accurate only by accident: nothing could write it, so calling it
 * the human axis cost nothing. Send changes that. For a purchase order, **issued IS sent to
 * the vendor** — one event, and the accounting word is the better one, so there is no
 * separate `sent` value — which makes `issued` a thing an action produces rather than a
 * value somebody picks. Typing it by hand claims an order went out that never did, and the
 * expediting list, the `expected_at` default and (per §6.1) the receipt pull-forward all
 * read it.
 *
 * `draft`, `closed` and `canceled` stay freely editable. They are genuine human decisions:
 * §3.6 deliberately does NOT derive `closed`, because an order where the vendor short-shipped
 * and the remainder has been forgiven must still be closeable and no derived rule could ever
 * close it.
 *
 * ⚠️ **This guard covers the CRUD chain only, and is NOT the main enforcement point.**
 * `UnifiedCrudHandler.runPreHooks` runs for `record.create`/`record.update`, bulk record
 * writes, the CSV importer and the SDK — worth having, and removing it would narrow
 * coverage. But every *interactive* edit goes through `fieldValue.set` ->
 * `FieldValueService`, which never reads this registry, so a drawer edit or a kanban drag
 * reaches only the field pre-hook twin in
 * `field-hooks/pre/purchase-order-status-guard.ts`. That one is what actually stops a human
 * typing `issued`. The two share their guarded set and message via
 * `PURCHASE_ORDER_ACTION_STATUSES` / `PURCHASE_ORDER_ACTION_STATUS_MESSAGE` so they cannot
 * drift, and `pre/quote-deposit-guard.ts` records the same finding for `quote_status`.
 *
 * The sanctioned writer reaches the field through `FieldValueService`, which bypasses this
 * chain entirely, so this guard never sees it. On the field chain it clears the twin by
 * naming `purchase_order_status` in `bypassFieldGuards`.
 */
const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: PURCHASE_ORDER_ACTION_STATUSES,
  message: PURCHASE_ORDER_ACTION_STATUS_MESSAGE,
})

/**
 * `purchase_order` system hooks: the RecordSequence number on create, and the lifecycle
 * guard that keeps `issued` an action rather than a dropdown value.
 */
export const PURCHASE_ORDER_HOOKS: SystemHookRegistry = {
  purchase_order_number: [autoGeneratePurchaseOrderNumber],
  purchase_order_status: [rejectManualLifecycleStatus],
}

/**
 * `vendor_bill_status` is written by the match hook rather than guarded here — the match
 * recomputes it from the lines on every create/update, so a manual write is overwritten
 * rather than rejected.
 */
export const VENDOR_BILL_HOOKS: SystemHookRegistry = {
  vendor_bill_internal_number: [autoGenerateVendorBillInternalNumber],
}

// packages/lib/src/resources/hooks/order-hooks.ts

import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Number the order on create. Mirrors autoGenerateInvoiceNumber.
 * order_number has creatable:false/updatable:false, so this hook is the only writer
 * when nothing is supplied (plans/products/08-order-build.md §5.3/§5.5). A data
 * connector that brings the source's own number (Shopify's `#1001`) keeps it and
 * no `ORD-` number is allocated: "theirs if they bring one, otherwise ours"
 * (plans/money/tasks/39-shopify-first-sync-followups.md section 6.5).
 */
const autoGenerateOrderNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'order')

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

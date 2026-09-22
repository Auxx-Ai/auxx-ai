// packages/lib/src/accounting/sales/fulfillments/index.ts

/**
 * `fulfillment` / `fulfillment_line` records: reads, writes and the pure
 * vocabulary over them (`plans/money/tasks/55-shipment-lines.md`).
 *
 * The shared contract behind `money/orders/fulfill.ts` (the native door),
 * `money/fulfillment-posting/**` (the bulk poster), the credit-memo readers,
 * and the order drawer's ledger card - none of them may query
 * `fulfillment` / `fulfillment_line` `FieldValue` rows directly; they come
 * through here so there is exactly one place that knows the field ids and the
 * join shape.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5). The
 * client-safe vocabulary lives in `client.ts`; a browser must import that,
 * never this.
 */

export {
  FULFILLMENT_SOURCE_KIND,
  type FulfillmentPostingResult,
  NothingToRecogniseError,
  type PreparedFulfillmentEntry,
  postFulfillmentAccounting,
  prepareFulfillmentEntry,
} from './accounting'
export { sweepFulfillmentAccounting } from './accounting-sweep'
export {
  defaultFulfillmentName,
  FULFILLMENT_STATUSES,
  type Fulfillment,
  type FulfillmentLine,
  type FulfillmentStatusValue,
  isLiveFulfillment,
} from './client'
export {
  FULFILLMENT_ATTRIBUTES,
  FULFILLMENT_LINE_ATTRIBUTES,
  type FulfillmentAttribute,
  type FulfillmentFieldContext,
  type FulfillmentLineAttribute,
  loadFulfillmentFieldContext,
  requireFulfillmentFieldContext,
} from './fields'
export {
  type FulfillmentCandidateWindow,
  findLiveFulfillmentDraft,
  listFulfillmentAccountingCandidates,
} from './posting-reads'
export {
  readFulfillmentPostingSubject,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
} from './reads'
export {
  type OrderShipment,
  resolveOrderShipments,
  type ShipmentLine,
  shapeShipmentLine,
} from './shipment-lines'
export { stampOrderShipmentTotals } from './stamp-totals'
export {
  FULFILLMENT_LINE_ORDER_TOTALS_RECONCILER,
  FULFILLMENT_ORDER_TOTALS_RECONCILER,
  registerFulfillmentTotalsReconcilers,
  stampTotalsOnFulfillmentChange,
  stampTotalsOnFulfillmentLineChange,
} from './totals-reconciler'
export type {
  CreatedFulfillment,
  CreateFulfillmentInput,
  CreateFulfillmentLineInput,
} from './types'
export { createFulfillment, deleteFulfillment } from './writes'

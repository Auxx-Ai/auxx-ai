// packages/lib/src/money/fulfillments/index.ts

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
  defaultFulfillmentName,
  FULFILLMENT_STATUSES,
  type Fulfillment,
  type FulfillmentLine,
  type FulfillmentStatusValue,
  isLiveFulfillment,
} from './client'
export {
  type FulfillmentFieldContext,
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
  requireFulfillmentFieldContext,
} from './reads'
export type {
  CreatedFulfillment,
  CreateFulfillmentInput,
  CreateFulfillmentLineInput,
  FulfillmentPostingStamp,
} from './types'
export { createFulfillment, deleteFulfillment, stampFulfillmentPosting } from './writes'

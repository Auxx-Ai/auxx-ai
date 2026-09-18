// packages/lib/src/sales/orders/index.ts

/**
 * Order fulfillment: the sanctioned action that records what shipped and posts
 * the revenue it recognises (plans/accounting/tasks/done/01-post-revenue-to-the-ledger.md,
 * HANDOFF slot 2G).
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 *
 * ⚠️ **The `fulfillment` / `fulfillment_line` record shapes and their reads and
 * writes live in `money/fulfillments`, not here** (entity migration 153,
 * `plans/money/tasks/55-shipment-lines.md` §6) - `Fulfillment`, `FulfillmentLine`,
 * `readFulfillmentsForOrder(s)`, `createFulfillment` and `deleteFulfillment` all
 * moved there when `order_fulfillments` stopped being a JSON cell. A
 * fulfillment's posting is never stamped on the record; it is read back
 * through `listPostingsForSource` (`postings/list-postings.ts`, TARGET §1).
 */

export {
  fulfillmentStatusFor,
  type NetUnitPriceInput,
  netUnitPriceMinor,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderLineRemaining,
  shippedByLine,
  shippedSubtotalMinor,
  shippingStillOwed,
} from './client'
export {
  type FulfillOrderInput,
  type FulfillOrderLine,
  type FulfillOrderResult,
  fulfillOrder,
  previewFulfillment,
  reverseFulfillmentPosting,
} from './fulfill'
export {
  type OrderForFulfillment,
  type OrderLineForFulfillment,
  readOrderForFulfillment,
  readOrderLines,
} from './reads'

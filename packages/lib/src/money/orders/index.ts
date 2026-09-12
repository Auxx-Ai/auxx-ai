// packages/lib/src/money/orders/index.ts

/**
 * Order fulfillment: the sanctioned action that records what shipped and posts
 * the revenue it recognises (plans/accounting/tasks/01-post-revenue-to-the-ledger.md,
 * HANDOFF slot 2G).
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 *
 * ⚠️ **The `fulfillment` / `fulfillment_line` record shapes and their reads and
 * writes live in `money/fulfillments`, not here** (entity migration 153,
 * `plans/money/tasks/55-shipment-lines.md` §6) - `Fulfillment`, `FulfillmentLine`,
 * `readFulfillmentsForOrder(s)`, `createFulfillment`, `stampFulfillmentPosting`
 * and `deleteFulfillment` all moved there when `order_fulfillments` stopped
 * being a JSON cell. `stampFulfillment` and `parseFulfillments`, which used to
 * export from here, no longer exist - stamping is now an ordinary field write
 * (`stampFulfillmentPosting`) and there is no JSON to parse.
 */

export {
  fulfillmentStatusFor,
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
} from './fulfill'
export {
  loadOrderFieldContext,
  type OrderFieldContext,
  type OrderForFulfillment,
  readOrderForFulfillment,
  requireOrderFieldContext,
} from './reads'

// packages/lib/src/money/orders/index.ts

/**
 * Order fulfillment: the sanctioned action that records what shipped and posts
 * the revenue it recognises (plans/accounting/tasks/01-post-revenue-to-the-ledger.md,
 * HANDOFF slot 2G).
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderFulfillment,
  type OrderFulfillmentLine,
  type OrderFulfillmentsEnvelope,
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
  parseFulfillments,
  readOrderForFulfillment,
  requireOrderFieldContext,
} from './reads'

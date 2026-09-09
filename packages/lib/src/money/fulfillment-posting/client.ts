// packages/lib/src/money/fulfillment-posting/client.ts

/**
 * The client-safe half of the bulk fulfillment poster: types and constants
 * only.
 *
 * Everything here is a re-export of `types.ts`, which already imports nothing.
 * The file exists so a browser has ONE import path to reach the vocabulary the
 * dialog renders - the reason `docs/lib-module-guide.md` §7 gives - and so the
 * server barrel (`index.ts`) is the only thing that ever pulls `reads.ts` and
 * `run.ts`, which reach `@auxx/database`, `bullmq` and friends.
 *
 * Deliberately NO `'use client'` directive: server code imports this file too,
 * and the directive would turn every export into a client-reference proxy
 * there. `money/orders/client.ts` carries the same warning for the same reason.
 */

export {
  FULFILLMENT_BATCH_SOURCE_TYPE,
  FULFILLMENT_POSTING_EXCLUSION_REASONS,
  FULFILLMENT_POSTING_GROUPINGS,
  FULFILLMENT_POSTING_MODES,
  FULFILLMENT_POSTING_SETTING_KEY,
  type FulfillmentDebitRole,
  type FulfillmentPostingExclusion,
  type FulfillmentPostingExclusionReason,
  type FulfillmentPostingGroup,
  type FulfillmentPostingGrouping,
  type FulfillmentPostingMode,
  type FulfillmentPostingPlan,
  type FulfillmentPostingPlanInput,
  type FulfillmentPostingRequest,
  type FulfillmentPostingRunSummary,
  type OrderFulfillmentPostingRef,
  type PlannedShipment,
  type ShipmentAmounts,
  type UnpostedShipment,
  type UnpostedShipmentLine,
} from './types'

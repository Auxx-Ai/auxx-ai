// packages/lib/src/money/fulfillment-posting/index.ts

/**
 * Bulk fulfillment posting: one `fulfillment` entry per day, week or month over
 * every shipment that no live posting claims
 * (`plans/money/tasks/49-bulk-fulfillment-posting.md`).
 *
 * The three halves, in the order a run uses them:
 *
 * 1. `reads.ts` - the netting read, in one SQL over the shipment log,
 * 2. `plan.ts` - PURE: grouping, exclusions and totals,
 * 3. `run.ts` - one `postEntry` per group and one stamp per shipment.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5). The client-safe
 * vocabulary lives in `client.ts`; a browser must import that, never this.
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
} from './client'
export { groupKeyFor, isoWeekKey, planFulfillmentPosting } from './plan'
export {
  countUnpostedShipments,
  type FulfillmentPostingSettings,
  listOrderFulfillmentPostings,
  readFulfillmentPostingSettings,
  readUnpostedShipments,
  type UnpostedShipmentRange,
} from './reads'
export {
  type FulfillmentPostingPreview,
  previewFulfillmentPosting,
  runFulfillmentPosting,
} from './run'

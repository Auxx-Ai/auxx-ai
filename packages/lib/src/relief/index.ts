// packages/lib/src/relief/index.ts

/**
 * Inventory relief when goods ship
 * (plans/money/tasks/50-batch-inventory-relief.md).
 *
 * Two halves, two owners while this brief is being built concurrently -
 * coordinate by re-reading this file before editing it, not by guessing:
 *
 * - `relieve.ts` (exported below): `relieveFulfillmentLines`, the writer, and
 *   its supporting types. Called from `money/orders/fulfill.ts` and
 *   `events/handlers/passes/fulfillment-log-pass.ts`.
 * - `backfill.ts`: `backfillFulfillmentRelief`, the RECORD-driven door. The
 *   two callers above both fire on arrival (a new dispatch, a sync manifest),
 *   so neither can reach a fulfillment already on disk; this one sweeps the
 *   organization's orders instead. Idempotent by relief's own delta
 *   arithmetic - see its header.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export {
  type BackfillFulfillmentReliefInput,
  type BackfillFulfillmentReliefSummary,
  type BackfillReliefProgress,
  backfillFulfillmentRelief,
} from './backfill'
export {
  type FulfillmentLineToRelieve,
  type RelieveFulfillmentLinesInput,
  type RelieveFulfillmentLinesResult,
  relieveFulfillmentLines,
} from './relieve'

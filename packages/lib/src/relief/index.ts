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
 * - `cost-reads.ts` (§3, a separate agent's surface): the ledger-average and
 *   relieved-average reads `relieve.ts` is written against. Its exports
 *   belong in their own block below the relief ones, never interleaved -
 *   that keeps this a clean two-section diff for whoever lands second.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5).
 */

export { readFulfillmentLineRelievedAverages, readPartLedgerAverages } from './cost-reads'
export {
  type FulfillmentLineToRelieve,
  type RelieveFulfillmentLinesInput,
  type RelieveFulfillmentLinesResult,
  relieveFulfillmentLines,
} from './relieve'
export type { FulfillmentLineRelievedAverage, PartLedgerAverage } from './types'

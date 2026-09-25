// packages/lib/src/inventory/movements/fact/index.ts

export type { ConsumptionClass, MovementClassLinks } from './classify'
export { classifyMovement } from './classify'
export type { MovementFactDrift } from './drift-check'
export { compareFactsToLedger } from './drift-check'
export { movementFactFromInput, readOriginalClasses } from './live'
export type {
  DailySeriesRow,
  FactDayRange,
  FactTotals,
  PoLineReceiptRow,
  UsageBucketRow,
  WhereUsedShareRow,
} from './reads'
export {
  readDailySeries,
  readFactTotalsByPart,
  readMovementFactClasses,
  readReceiptsForPoLines,
  readUsageBuckets,
  readWhereUsedShares,
} from './reads'
export { classifyFacts, MOVEMENT_FACT_PICK, rebuildMovementFacts } from './rebuild'
export type { MovementFactInput } from './writes'
export {
  deleteMovementFacts,
  deleteOrganizationMovementFacts,
  insertMovementFacts,
  updateMovementFactAnchor,
} from './writes'

// packages/lib/src/inventory/movements/index.ts

export {
  computeExtendedCost,
  DEFAULT_RECEIPT_INVENTORY_ROLE,
  INVENTORY_ROLE_BY_PART_KIND,
  resolveInventoryRoleForPartKind,
} from './client'
export { assertCostFieldsMaterialized } from './cost-fields'
export type {
  ConsumptionClass,
  DailySeriesRow,
  FactDayRange,
  MovementFactDrift,
  MovementFactInput,
  PoLineReceiptRow,
  UsageBucketRow,
  WhereUsedShareRow,
} from './fact'
export {
  classifyMovement,
  compareFactsToLedger,
  deleteMovementFacts,
  insertMovementFacts,
  readDailySeries,
  readReceiptsForPoLines,
  readUsageBuckets,
  readWhereUsedShares,
  rebuildMovementFacts,
  updateMovementFactAnchor,
} from './fact'
export type { FilledStockMovement, PendingCostFill } from './fill-pending-cost'
export { FILL_PENDING_COST_REASON, fillPendingCost } from './fill-pending-cost'
export type { ReverseMovementInput } from './reverse-movement'
export { reverseMovement } from './reverse-movement'
export type {
  MovementRecord,
  StockMovementInput,
  StockMovementLinks,
  StockMovementsCtx,
  StockMovementsLane,
  WriteStockMovementsResult,
  WrittenStockMovement,
} from './types'
export type { ResolvedStockMovementLinks, StockMovementValueFields } from './values'
export { buildStockMovementValues } from './values'
export { writeStockMovements } from './write-movements'

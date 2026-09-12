// packages/lib/src/returns/index.ts

/**
 * Server entry point for the returns module.
 *
 * Everything in it is currently pure - the salvage tree, the three invariants,
 * the valuation and the over-return guard - so this barrel and `client.ts`
 * carry the same names. The gated salvage writer (plan section 6.3, step 7)
 * and the return queries land here, not in `client.ts`.
 */

export {
  checkOverReturn,
  type OverReturnCheckInput,
  type ReturnedQuantityClaim,
  remainingReturnableQuantity,
  sumReturnedQuantity,
} from './over-return-guard'
export {
  computeSalvageUnitCost,
  isUsableSalvagePercent,
  isUsableStandardCost,
  type SalvageUnitCostInput,
} from './salvage-cost'
export {
  InvalidReturnQuantityError,
  MissingStandardCostError,
  NestedGoodSalvageNodeError,
  OverReturnError,
  SalvagePercentOutOfRangeError,
  SalvageQuantityExceedsAllowanceError,
  type SalvageRefusal,
  type SalvageRefusalReason,
} from './salvage-errors'
export {
  checkNoNestedGoodNodes,
  checkSalvageQuantityBounds,
  checkSalvageStandardCosts,
  checkSalvageTree,
  findMissingStandardCosts,
  findQuantityAllowanceBreaches,
  findShadowedGoodNodes,
  type SalvageQuantityBoundsInput,
  type SalvageStandardCostInput,
  type SalvageTreeCheckInput,
  selectSalvageMovementNodes,
} from './salvage-invariants'
export {
  type BuildSalvageTreeInput,
  bomQuantity,
  buildSalvageTree,
  findSalvageNode,
  flattenSalvageTree,
} from './salvage-tree'
export {
  DEFAULT_SALVAGE_PERCENT,
  MAX_SALVAGE_DEPTH,
  type MaterializedSalvageRow,
  ROOT_SALVAGE_KEY,
  SALVAGE_STATUSES,
  type SalvageNode,
  type SalvagePartInfo,
  type SalvageStatus,
  type SubpartEdge,
  type SubpartGraph,
} from './types'

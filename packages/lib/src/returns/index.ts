// packages/lib/src/returns/index.ts

/**
 * Server entry point for the returns module.
 *
 * Two halves. The pure half - the salvage tree, the three invariants, the
 * valuation, the over-return guard, the status vocabulary and the node-key
 * parser - is shared with `client.ts`. The database half below it - the reads,
 * the salvage assembly and the writes - is server only and must never reach a
 * browser bundle.
 *
 * 🛑 The gated salvage writer (plan section 6.3, step 7) is NOT here. Nothing
 * in this module writes a stock movement: a `return_part_line` records a
 * decision, and turning the highest `good` node in a branch into a `return_in`
 * waits on the chain ending at task 50.
 */

export {
  loadReturnFieldContext,
  loadReturnLineFieldContext,
  loadReturnPartLineFieldContext,
  RETURN_ATTRIBUTES,
  RETURN_LINE_ATTRIBUTES,
  RETURN_PART_LINE_ATTRIBUTES,
  type ReturnFieldContext,
  type ReturnLineFieldContext,
  type ReturnPartLineFieldContext,
  requireReturnFieldContext,
  requireReturnLineFieldContext,
  requireReturnPartLineFieldContext,
} from './field-context'
export {
  checkOverReturn,
  type OverReturnCheckInput,
  type ReturnedQuantityClaim,
  remainingReturnableQuantity,
  sumReturnedQuantity,
} from './over-return-guard'
export {
  getReturn,
  getReturnLine,
  type ListReturnsFilters,
  listReturns,
  type ReturnableQuantity,
  type ReturnLineRecord,
  type ReturnLineWithPartLines,
  type ReturnPartLineRecord,
  type ReturnRecord,
  type ReturnWithLines,
  readReturnableQuantity,
  readReturnCeiling,
  readReturnedQuantityClaims,
  readReturnLine,
  readReturnLinesByReturn,
  readReturnPartLine,
  readReturnPartLines,
  requireReturnLine,
} from './reads'
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
  type BomSalvageNodeKey,
  type ParsedSalvageNodeKey,
  parseSalvageNodeKey,
  type RowSalvageNodeKey,
  syntheticSalvageNodeKey,
} from './salvage-node-key'
export {
  assembleSalvageTree,
  readSalvagePartInfos,
  readSalvageTree,
  type SalvageTreeView,
  toMaterializedRow,
} from './salvage-reads'
export {
  type BuildSalvageTreeInput,
  bomQuantity,
  buildSalvageTree,
  findSalvageNode,
  flattenSalvageTree,
} from './salvage-tree'
export {
  isPreInspectionStatus,
  PRE_INSPECTION_RETURN_STATUSES,
  RETURN_LINE_CONDITION_GRADES,
  RETURN_LINE_LIABILITIES,
  RETURN_ORIGINS,
  RETURN_STATUSES,
  type ReturnLineConditionGrade,
  type ReturnLineLiability,
  type ReturnOrigin,
  type ReturnStatus,
  toReturnStatus,
} from './status'
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
export {
  createReturn,
  createReturnLine,
  expandSalvageNode,
  type ReturnInput,
  type ReturnLineInput,
  setSalvageNodeQuantity,
  setSalvageNodeStatus,
  splitSalvageNode,
  updateReturn,
  updateReturnLine,
} from './writes'

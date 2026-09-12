// packages/lib/src/returns/client.ts

/**
 * Client-safe surface of the returns module: the salvage tree's type contract,
 * its vocabulary, the return status vocabulary, and every pure function over
 * them.
 *
 * Everything re-exported here is plain arithmetic, string and graph work over
 * plain data - no `@auxx/database`, no queue, no cache - so the salvage tree
 * card and the return create dialog can import it directly. The server barrel
 * (`index.ts`) re-exports the same names alongside the reads and writes, which
 * must never reach a browser bundle.
 *
 * No `'use client'` directive: server code imports this file too, and the
 * directive would turn every export into a client-reference proxy there
 * (`docs/lib-module-guide.md` section 7).
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
  type BomSalvageNodeKey,
  type ParsedSalvageNodeKey,
  parseSalvageNodeKey,
  type RowSalvageNodeKey,
  syntheticSalvageNodeKey,
} from './salvage-node-key'
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

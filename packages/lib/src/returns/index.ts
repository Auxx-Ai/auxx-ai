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
 * ✅ **The salvage writer IS here now** (`salvage-writer.ts`, plan section 6.3,
 * step 7). Its gate lifted on 2026-09-12 when #2143 and #2144 landed the shared
 * `writeStockMovements` and inventory relief at ship, which were the last two
 * links in the chain section 6.1 tabled.
 *
 * 🛑 So this module DOES write to the append-only ledger, and the rules that
 * come with that are not optional. A salvage `return_in` sets no
 * `adjustSubparts` (it would restock the same material twice AND drop the row
 * out of `bom/qoh.ts`'s SUM) and no `fulfillmentLine` (that link is relief's
 * netting, and both 50 and 55 deleted a scope rule on the promise that 54
 * points elsewhere). It runs on a quiet session and therefore OWES one
 * post-commit `batchRecalculateQoH` over the `affectedPartIds` it returns.
 *
 * Everything else in here still only records decisions: a `return_part_line`
 * holds a disposition, and only the highest `good` node in a branch ever
 * becomes a movement.
 */

export {
  generateReturnEvidencePack,
  RETURN_EVIDENCE_PACK_DOCUMENT_TYPE,
  type ReturnEvidencePackResult,
} from './evidence-pack'
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
  readUnlinkedCreditMemosForOrder,
  requireReturnLine,
  type UnlinkedCreditMemo,
} from './reads'
export { type ReturnableLine, readReturnableLinesForOrder } from './returnable-lines'
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
  announceQuietSalvageWrites,
  reverseSalvageMovement,
  SALVAGE_WRITE_LANE_REASON,
  type SalvageMovementWritten,
  salvageWriteSession,
  type WriteSalvageMovementsInput,
  type WriteSalvageMovementsResult,
  writeSalvageMovements,
} from './salvage-writer'
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
  setSalvagePercent,
  splitSalvageNode,
  updateReturn,
  updateReturnLine,
} from './writes'

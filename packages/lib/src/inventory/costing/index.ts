// packages/lib/src/inventory/costing/index.ts

export {
  absorbedRate,
  absorbsConversionCost,
  isBuildablePartKind,
  isServicePartKind,
  isUsableStoredStandard,
  type PartKindValue,
  resolvePartKind,
  resolveStandardCostSource,
  rolledStandardCostSource,
  type StandardCostOriginValue,
  type StandardCostSourceValue,
} from './client'
export {
  buildParentGraph,
  buildSubpartGraph,
  type CostSourceValue,
  loadOrgSubpartEdges,
  type OrgPricingData,
  type ParentGraph,
  type PartCostResult,
  recalculateAffectedParts,
  recalculateAllPartCosts,
  type SubpartGraph,
  type SubpartRow,
  type VendorCostMaps,
  type VendorPriceRow,
} from './cost-calculator'
export {
  type ReadFulfillmentLineRelievedAveragesParams,
  type ReadPartLedgerAveragesParams,
  readFulfillmentLineRelievedAverages,
  readPartLedgerAverages,
} from './cost-reads'
export { type CostWrite, writeCostValues } from './cost-writer'
// Dated ledger reads (111 D23 / Q26): the replay behind backflush and the count re-anchor.
export {
  readEarliestMovementAt,
  readLatestMovementAt,
  readPartBuiltTotal,
  readPartNetThrough,
} from './dated-reads'
// A FIRST standard from a cost a door names (receipt, count, typed). It never overwrites.
export {
  type EnsureStandardCostResult,
  type EnsureStandardCostSource,
  ensureStandardCost,
} from './ensure-standard-cost'
// The pricer (111 Q18/Q22): a first standard values the part's `pending` rows and
// posts their documents. Inline from every standard door; the recovery lane retries.
export {
  type PricingSummary,
  pricePendingMovements,
  pricePendingMovementsQuietly,
} from './price-pending-movements'
// A receipt confirming a provisional standard (73 §6.4), or a typed cost on a moved part (D-SC2a).
export {
  type ReplaceProvisionalStandardOptions,
  type ReplaceProvisionalStandardResult,
  type ReplaceStandardDoor,
  replaceProvisionalStandard,
} from './provisional-standard'
export { batchRecalculateQoH } from './qoh'
// The count anchor (111 Q26): the one movement allowed to move, in front of the QoH SUM.
export {
  anchorSeam,
  onInitialReanchored,
  REANCHOR_INITIAL_REASON,
  type ReanchoredInitial,
  reanchorInitials,
} from './reanchor-initials'
// The cost-only movement: quantity 0, a signed extended cost, one entry of kind
// `revalue` (73 §6.2 rule 2). The roll and the provisional replace both post
// through here; §7's landed-cost voucher is next.
export {
  type RevaluationLine,
  type WriteRevaluationInput,
  type WriteRevaluationResult,
  writeRevaluation,
} from './revalue'
export { rollUnvaluedAncestors } from './roll-unvalued-ancestors'
// A typed unit cost (106 §5, D-SC2a, D-SC3).
export {
  bomRefusal,
  readMovedPartIds,
  readPartIdsWithBom,
  type SetStandardCostOptions,
  type StandardCostEntry,
  type StandardCostEntryOutcome,
  type StandardCostWrite,
  setStandardCost,
  setStandardCosts,
} from './set-standard-cost'
export { rollStandardCost } from './standard-cost'
export {
  loadPartAbsorptionRates,
  loadStandardCostFields,
  loadStandardCostWriteContext,
  previewStandardCostRoll,
  readStandardCost,
  type StandardCostFields,
  type StandardCostWriteContext,
} from './standard-cost-queries'
export {
  computeStandardCosts,
  type StandardCostRollComputation,
  type StandardCostRollInputs,
  type SubpartEdge,
  widenToAncestors,
  widenToUnvaluedDescendants,
} from './standard-cost-roll'
// What Set costs and Set counts show per part: standard, suggestion inputs, BOM leaves (D-SC3).
export {
  buildStandardCostWorklist,
  readStandardCostWorklist,
  type StandardCostWorklistPart,
  type WorklistPartFacts,
} from './standard-cost-worklist'
export type {
  AbsorptionRates,
  FulfillmentLineRelievedAverage,
  KeptManualPart,
  PartLedgerAverage,
  PartStandardCost,
  RollDateRange,
  RollStandardCostInput,
  SkippedPart,
  SkipReason,
  StandardCostComponents,
  StandardCostRollLine,
  StandardCostRollPlan,
  StandardCostRollResult,
} from './types'
export type {
  LandedCostBreakdown,
  OfferTariff,
  OfferTariffInputs,
  TariffRateComponent,
  TariffRateRow,
  TariffResolution,
  TariffResolutionStatus,
  VendorCostRow,
} from './vendor-cost'
export {
  composeTariffCodeLabel,
  computeLandedBreakdown,
  computeLandedCost,
  resolveOfferTariff,
  resolveTariffRate,
  selectWinningVendor,
} from './vendor-cost'

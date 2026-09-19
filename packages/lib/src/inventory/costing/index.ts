// packages/lib/src/inventory/costing/index.ts

export {
  absorbedRate,
  absorbsConversionCost,
  type PartKindValue,
  resolveAbsorptionRates,
  resolvePartKind,
  resolveStandardCostSource,
  rolledStandardCostSource,
  type StandardCostSourceValue,
} from './client'
export {
  type CostSourceValue,
  type OrgPricingData,
  type PartCostResult,
  recalculateAffectedParts,
  recalculateAllPartCosts,
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
// The ONLY writer of a FIRST standard cost (plans/money/tasks/15 §1). It never
// overwrites, which is what makes it safe to call from a post-commit hook.
export {
  type EnsureStandardCostResult,
  type EnsureStandardCostSource,
  ensureStandardCost,
} from './ensure-standard-cost'
// The first receipt of a part whose standard was a guess (73 §6.4). U5's
// receipt path reads `replaced` to skip its `ppv` leg.
export {
  type ReplaceProvisionalStandardResult,
  replaceProvisionalStandard,
} from './provisional-standard'
export { batchRecalculateQoH } from './qoh'
// The cost-only movement: quantity 0, a signed extended cost, one entry of kind
// `revalue` (73 §6.2 rule 2). The roll and the provisional replace both post
// through here; §7's landed-cost voucher is next.
export {
  type RevaluationLine,
  type WriteRevaluationInput,
  type WriteRevaluationResult,
  writeRevaluation,
} from './revalue'
export { rollStandardCost } from './standard-cost'
export {
  loadAbsorptionRates,
  loadEffectiveAbsorptionRates,
  loadPartAbsorptionOverrides,
  loadStandardCostFields,
  loadStandardCostWriteContext,
  type PartAbsorptionOverrides,
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
export type {
  AbsorptionRates,
  FulfillmentLineRelievedAverage,
  PartLedgerAverage,
  PartStandardCost,
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

// packages/lib/src/inventory/costing/index.ts

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
export { batchRecalculateQoH } from './qoh'
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
export type { FulfillmentLineRelievedAverage, PartLedgerAverage } from './types'
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

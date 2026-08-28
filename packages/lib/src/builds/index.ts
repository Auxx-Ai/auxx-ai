// packages/lib/src/builds/index.ts

/**
 * Builds — phase 1: standard cost.
 *
 * plans/products/build/01-build-plan.md section 2. The `build` entity,
 * `completeBuild` and `reverseBuild` are phase 2 and land in this same folder.
 */

export {
  absorbedRate,
  absorbsConversionCost,
  type PartKindValue,
  resolvePartKind,
  roundMinorUnits,
  standardCostDrift,
} from './client'
export { rollStandardCost } from './standard-cost'
export {
  loadAbsorptionRates,
  loadStandardCostFields,
  previewStandardCostRoll,
  readStandardCost,
  type StandardCostFields,
} from './standard-cost-queries'
export {
  computeStandardCosts,
  type StandardCostRollComputation,
  type StandardCostRollInputs,
  type SubpartEdge,
  widenToAncestors,
} from './standard-cost-roll'
export type {
  AbsorptionRates,
  PartStandardCost,
  RollStandardCostInput,
  SkippedPart,
  SkipReason,
  StandardCostComponents,
  StandardCostRollLine,
  StandardCostRollPlan,
  StandardCostRollResult,
} from './types'

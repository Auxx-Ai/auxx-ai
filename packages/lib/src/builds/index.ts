// packages/lib/src/builds/index.ts

/**
 * Builds — the standard cost (phase 1) and the build event (phase 2).
 *
 * plans/products/build/01-build-plan.md sections 2 and 3.
 *
 * `completeBuild` is the ONLY export here that writes a stock movement, and it
 * is gated on a real `part_standard_cost` (README B2). Everything else — the
 * entity, the list, the plan, the auto-build trigger — can be used before the
 * first standard has ever been rolled without producing a wrong number.
 */

export { cancelBuild, createBuild, startBuild } from './build-mutations'
export {
  type BuildComponentPlanInput,
  type BuildFieldContext,
  type BuildMovementFieldContext,
  explodeBuildComponents,
  getBuild,
  listBuilds,
  listUnpostedBuilds,
} from './build-queries'
export {
  absorbedRate,
  absorbsConversionCost,
  BUILD_STATUS_LABELS,
  BUILD_VARIANCE_ACCOUNT,
  type BuildStatusValue,
  buildVariance,
  canCancelBuild,
  canCompleteBuild,
  canReverseBuild,
  canStartBuild,
  componentConsumption,
  type PartKindValue,
  resolveBuildStatus,
  resolvePartKind,
  roundMinorUnits,
  standardCostDrift,
  unitsStarted,
} from './client'
export { completeBuild } from './complete-build'
export { reverseBuild } from './reverse-build'
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
  BuildComponentLine,
  BuildComponentOverride,
  BuildComponentPlan,
  BuildMovementRow,
  BuildRecord,
  CancelBuildInput,
  CompleteBuildInput,
  CompleteBuildResult,
  CreateBuildInput,
  ListBuildsFilters,
  PartStandardCost,
  ReverseBuildInput,
  ReverseBuildResult,
  RollStandardCostInput,
  SkippedPart,
  SkipReason,
  StandardCostComponents,
  StandardCostRollLine,
  StandardCostRollPlan,
  StandardCostRollResult,
  StartBuildInput,
} from './types'
export { BUILD_WRITE_LANE_REASON, buildWriteSession } from './write-lane'

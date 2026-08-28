// packages/lib/src/builds/index.ts

/**
 * Builds — the standard cost (phase 1) and the build event (phase 2).
 *
 * plans/products/build/01-build-plan.md sections 2 and 3.
 *
 * `completeBuild` is the ONLY export here that writes a stock movement, and it
 * is gated on a real `part_standard_cost` (README B2). Everything else — the
 * entity, the list, the plan, the order reconciler — can be used before the
 * first standard has ever been rolled without producing a wrong number.
 */

export {
  type AutoBuildCancellationAction,
  type AutoBuildCancellationFailure,
  type AutoBuildCancellationOutcome,
  type AutoBuildCancellationSummary,
  cancelAutoBuildsForOrders,
} from './auto-build-cancel'
export {
  AUTO_BUILD_STATUSES,
  AUTO_BUILD_STOCK_RULES,
  type AutoBuildLine,
  type AutoBuildStatus,
  type AutoBuildStockRule,
  isCoveredByStock,
  isWithinEnablementWindow,
  parseAutoBuildEnabledAt,
  resolveAutoBuildStatus,
  resolveAutoBuildStockRule,
  sumQuantityByPart,
} from './auto-build-policy'
export {
  type AutoBuildOrder,
  loadAutoBuildOrders,
  readPartQuantitiesOnHand,
} from './auto-build-queries'
export { CANCEL_AUTO_BUILDS_ON_ORDER_CANCELLED, registerAutoBuildRules } from './auto-build-rule'
export { type AutoBuildSettings, loadAutoBuildSettings } from './auto-build-settings'
export {
  amendPlannedBuildQuantity,
  cancelBuild,
  createBuild,
  startBuild,
} from './build-mutations'
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
  absorbedRunCost,
  absorbsConversionCost,
  BUILD_STATUS_LABELS,
  BUILD_VARIANCE_ACCOUNT,
  type BuildCompletionInputs,
  type BuildCompletionSummary,
  type BuildStatusValue,
  buildVariance,
  canAmendBuild,
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
  summarizeBuildCompletion,
  unitsStarted,
} from './client'
export { completeBuild } from './complete-build'
// Model A+ drift (plans/products/13) — the read that shows an order and a build
// disagreeing. Read-only; Model B's convergence is `reconcileOrderBuilds`.
export { type BuildDrift, readBuildDrift } from './drift-queries'
export {
  markOrStampOrder,
  markOrStampOrderLine,
  reconcileOrdersFromSync,
  registerOrderDriftReconcilers,
} from './drift-reconciler'
export { hasDrifted, type OrderDemand, orderDemandFingerprint } from './order-fingerprint'
export {
  type OrderBuildAmendment,
  type OrderBuildCancellation,
  type OrderBuildRaise,
  type OrderBuildReconcileFailure,
  type OrderBuildReconcileSkip,
  type OrderBuildReconcileSkipReason,
  type OrderBuildReconcileSummary,
  type ReconcileOrderInput,
  reconcileOrderBuilds,
} from './reconcile-order-builds'
// Model B (plans/products/13, events/08 phase 5) — the decision, then the writer.
export {
  type BuildConvergenceAction,
  type ConvergenceSkipReason,
  type OrderBuildConvergenceInput,
  type OrderBuildPlan,
  planOrderBuildConvergence,
} from './reconcile-policy'
export { readOrderRaisedBuilds } from './reconcile-queries'
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

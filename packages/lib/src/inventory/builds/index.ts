// packages/lib/src/inventory/builds/index.ts

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
export {
  type AutoBuildSettings,
  type BackflushSettings,
  loadAutoBuildSettings,
  loadBackflushSettings,
} from './auto-build-settings'
export {
  endOfLocalDay,
  executeBackfill,
  raiseAndCompleteBuild,
  resolveBackfillCompletedAt,
} from './backfill-builds'
export { planBackfill } from './backfill-policy'
// §7.3's gates 2, 3 and 4. Moved out of `routers/builds.ts` (44 §11.3): a router
// asserts and calls, it does not compose the arithmetic.
export { computeBackfillPreflight } from './backfill-preflight'
export { readBackfillPlanReads } from './backfill-queries'
export {
  BACKFILL_EXCLUSION_REASONS,
  BACKFILL_GROUPINGS,
  type BackfillBucket,
  type BackfillCoverage,
  type BackfillDemandLine,
  type BackfillExclusion,
  type BackfillExclusionReason,
  type BackfillGrouping,
  type BackfillPartPlan,
  type BackfillPlan,
  type BackfillPlanInput,
  type BackfillPreflight,
  type BackfillRequest,
  type BackfillRunSummary,
  type BackfillStatus,
} from './backfill-types'
// Backflush (111 D23/D24): the replay that builds what sales drove negative, and its preview.
export { type BackflushInput, backflushBuilds } from './backflush'
export { previewBackflush, summarizeBackflushPlan } from './backflush-preview'
export {
  type BackflushRange,
  NIGHTLY_BACKFLUSH_LOOKBACK_DAYS,
  resolveBackflushRange,
} from './backflush-range'
export {
  type BackflushStep,
  finalizeBackflushRun,
  runBackflushSlice,
  startBackflushRun,
} from './backflush-run'
export { readBackflushRunRow, toBackflushRun } from './backflush-run-queries'
export type {
  BackflushBuild,
  BackflushPlan,
  BackflushPlanPart,
  BackflushPlanSummary,
  BackflushRun,
  BackflushRunFailure,
  BackflushRunStatus,
  BackflushRunSummary,
} from './backflush-types'
// The batch run reads (plans/money/tasks/45 §10.4). `readBatchRun` is what the
// drawer card and the undo preview render; `readBatchRunBuilds` is the per-build
// set `undoBatchRun` acts on, exported rather than private because reads and
// writes live in separate files.
export {
  type BatchRunBuild,
  listBatchRuns,
  readBatchRun,
  readBatchRunBuilds,
} from './batch-run-queries'
export {
  amendPlannedBuildQuantity,
  cancelBuild,
  createBuild,
  startBuild,
} from './build-mutations'
// One call that raises, starts and completes. NOT atomic — a refused completion
// comes back as `left_in_progress` carrying the run it left behind (§3.3).
export { type BuildNowInput, type BuildNowOutcome, buildNow } from './build-now'
export {
  type BuildComponentPlanInput,
  type BuildContext,
  explodeBuildComponents,
  getBuild,
  listBuilds,
  listUnpostedBuilds,
} from './build-queries'
export {
  absorbedRunCost,
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
  resolveBuildStatus,
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
// Kind conflicts (plans/mrp/17 D3): the read that blocks backflush, and the "keep it" flag.
export {
  clearKindConflictConfirmations,
  confirmKindConflicts,
} from './kind-conflict-mutations'
export {
  type KindConflict,
  type KindConflictReason,
  kindConflictFor,
  type SuggestedPartKind,
  suggestedKindFor,
} from './kind-conflict-policy'
export {
  type KindConflictEdges,
  readKindConflictEdges,
  readKindConflictFacts,
  readKindConflicts,
} from './kind-conflicts'
export {
  loadMovementAccountDrift,
  type MovementAccountDrift,
  type MovementAccountDriftPart,
  readMovementAccountDrift,
  readPostedMovementIds,
} from './movement-account-drift'
export {
  type AccountCorrectionLeg,
  type DriftedMovement,
  expectedInventoryRole,
  type PartAccountDriftPlan,
  planPartAccountDrift,
} from './movement-account-drift-plan'
export {
  accountFixOccurrence,
  type FixMovementAccountsOutcome,
  fixMovementAccounts,
} from './movement-account-fix'
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
export type {
  BatchRunSummary,
  BuildComponentLine,
  BuildComponentOverride,
  BuildComponentPlan,
  BuildMovementRow,
  BuildRecord,
  BuildSourceValue,
  CancelBuildInput,
  CompleteBuildInput,
  CompleteBuildResult,
  CreateBuildInput,
  ListBuildsFilters,
  ReverseBuildInput,
  ReverseBuildResult,
  StartBuildInput,
  UndoBatchRunEntry,
  UndoBatchRunSummary,
} from './types'
export {
  findLiveBackflushOrUndoRun,
  hasStandingBackflushBuilds,
  listBackflushRunNumbers,
  readUndoBackflushRunRow,
  toUndoBackflushRun,
} from './undo-backflush-queries'
export {
  finalizeUndoBackflushRun,
  runUndoBackflushSlice,
  startUndoBackflushRun,
  type UndoBackflushStep,
} from './undo-backflush-run'
export type {
  UndoBackflushFailure,
  UndoBackflushRun,
  UndoBackflushRunMetadata,
  UndoBackflushScope,
} from './undo-backflush-types'
// Undo a whole batch run (plans/money/tasks/45 §4). Cancels what is `planned`
// or `in_progress` and REVERSES what is `completed`, never deletes, and never
// throws: per-build isolation, the same discipline `executeBackfill` keeps.
export { undoBatchRun } from './undo-batch-run'
export { BUILD_WRITE_LANE_REASON, buildWriteSession } from './write-lane'

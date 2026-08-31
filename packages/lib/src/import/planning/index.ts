// packages/lib/src/import/planning/index.ts

export { type AnalyzeRowContext, analyzeRow } from './analyze-row'
export { type AssignRowInput, assignRowToStrategy, batchAssignRows } from './assign-row-to-strategy'
export {
  type BatchedIdentifierLookup,
  type BatchIdentifierLookupOptions,
  createBatchedFindExistingRecord,
} from './batch-identifier-lookup'
export { calculateEstimates, calculateEstimatesFromCounts } from './calculate-estimates'
export { createPlan } from './create-plan'
export {
  type CreateStrategyInput,
  createDefaultStrategies,
  createStrategy,
} from './create-strategy'
export {
  createFindExistingRecord,
  type FindExistingRecord,
  type FindExistingRecordOptions,
  type FindExistingRecordResult,
  hasSystemTable,
  type IdentifierValues,
  stripRecordIdPrefix,
} from './find-existing-record'
export {
  type AnalyzedRow,
  type GeneratePlanOptions,
  type GeneratePlanResult,
  generatePlan,
} from './generate-plan'
export {
  getJobFailureSummary,
  getPlanErrors,
  getPlanWarnings,
  getPlanWithEstimates,
  type JobFailureReason,
  type JobFailureSummary,
  type PlanError,
  type PlanWarning,
  type PlanWarningsResult,
  type PlanWithEstimates,
} from './get-plan'
export {
  type GetPlanPreviewOptions,
  getPlanPreviewRows,
  type PlanPreviewResult,
  type PlanPreviewRow,
} from './get-plan-preview-rows'
export { markPlanCompleted } from './update-plan-status'

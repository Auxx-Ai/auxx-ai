// packages/lib/src/import/execution/index.ts

export {
  buildMultipleRecordData,
  buildRecordData,
  getSourceValue,
  type SourceRow,
} from './build-record-data'
export {
  type BatchRecord,
  type BatchRecordData,
  type ExecuteBatchContext,
  executeBatch,
} from './execute-batch'
export { type ExecutePlanOptions, executePlan } from './execute-plan'
export {
  type ExecuteStrategyContext,
  executeStrategy,
  type StrategyExecutionResult,
  stripBlankValues,
  type UpdatePolicy,
} from './execute-strategy'
export {
  isBlankValue,
  keysWithStrategy,
  loadNonBlankFieldKeys,
  type MergeStrategyByKey,
  parseMergeStrategies,
} from './merge-strategy'
export {
  claimImportManifestConsumed,
  getImportManifest,
  markJobCompleted,
  markJobExecuting,
  markJobFailed,
  saveImportManifest,
  updateJobProgress,
} from './track-progress'

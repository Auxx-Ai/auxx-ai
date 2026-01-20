// packages/lib/src/import/index.ts

// Types
export * from './types'

// Hashing utilities
export { hashValue, countOccurrences } from './hashing'

// Job management
export {
  createImportJob,
  getJobByOrg,
  getJobWithMapping,
  getJobWithMappingProperties,
  updateJobStatus,
  finalizeUpload,
  incrementReceivedChunks,
  markJobPlanning,
  markJobReady,
  allowPlanGeneration,
  listJobsByOrg,
  deleteJob,
  type CreateJobInput,
  type CreateJobResult,
  type ListJobsInput,
  type DeleteJobInput,
} from './job'

// Mapping utilities
export {
  getMappablePropertiesWithSamples,
  getColumnSamples,
  saveMappingProperty,
  batchUpdateMappingsFromAutoMap,
  getMappedColumnsWithStats,
  updateMappingTitle,
  runAutoMap,
  type MappablePropertyWithSamples,
  type SaveMappingInput,
  type RelationConfig,
  type AutoMapUpdateInput,
  type GetMappedColumnsInput,
  type MappedColumnWithStats,
  type UpdateMappingTitleInput,
  type RunAutoMapInput,
  type RunAutoMapResult,
  type AutoMapStrategy,
} from './mapping'

// Resolution
export {
  resolveValue,
  getResolver,
  isValidResolutionType,
  getAvailableResolutionTypes,
  processColumnValues,
  getCachedResolutions,
  getAllJobResolutions,
  cacheResolution,
  batchCacheResolutions,
  getUniqueValuesWithResolution,
  updateValueResolution,
  getResolutionProgress,
  // Resolvers
  resolveTextValue,
  resolveTextCuid,
  resolveInteger,
  resolveDecimal,
  resolveDateIso,
  resolveDateCustom,
  resolveDatetimeIso,
  resolveDatetimeCustom,
  resolveBoolean,
  resolveEmail,
  resolvePhone,
  resolveSelectValue,
  resolveSelectCreate,
  resolveMultiselectSplit,
  resolveDomain,
  resolveArraySplit,
  resolveRelationMatch,
  resolveRelationCreate,
  isPendingRelationLookup,
  // Relation lookups
  resolveRelationLookups,
  updateResolutionsWithLookupResults,
  getPendingRelationLookups,
  // Types
  type UniqueValueWithResolution,
  type UniqueValuesWithFieldConfig,
  type ResolutionStatus,
  type EffectiveStatus,
  type UpdateResolutionInput,
  type ResolutionProgress,
  type ProcessColumnValuesOptions,
  type CacheResolutionInput,
  type PendingRelationLookup,
  type RelationLookupResult,
} from './resolution'

// Raw data operations
export {
  storeRawData,
  storeRawDataChunk,
  getRawData,
  getRawDataAsArray,
  getRawDataAsMap,
  getColumnValues,
  getColumnUniqueValues,
  getRowData,
  getBatchRowData,
  type RawDataCell,
} from './raw-data'

// Field utilities
export {
  getImportableFields,
  getRequiredFields,
  getIdentifiableFields,
  getIdentifierOptions,
  autoMapColumns,
  suggestResolutionType,
  getValidResolutionTypes,
  orchestrateAutoMap,
  type ImportableField,
  type FieldGroup,
  type GetImportableFieldsOptions,
  type IdentifierOption,
  type ColumnHeader,
  type ColumnAutoMapping,
  type ColumnHeaderWithSamples,
  type AutoMapOptions,
} from './fields'

// Planning
export {
  createPlan,
  createStrategy,
  createDefaultStrategies,
  analyzeRow,
  assignRowToStrategy,
  batchAssignRows,
  calculateEstimates,
  calculateEstimatesFromCounts,
  createFindExistingRecord,
  generatePlan,
  getPlanWithEstimates,
  getPlanErrors,
  getPlanPreviewRows,
  markPlanCompleted,
  type FindExistingRecordOptions,
  type PlanWithEstimates,
  type PlanError,
  type PlanPreviewRow,
  type GetPlanPreviewOptions,
  type PlanPreviewResult,
  type AnalyzedRow,
  type CreateStrategyInput,
  type AnalyzeRowContext,
  type AssignRowInput,
  type GeneratePlanOptions,
  type GeneratePlanResult,
} from './planning'

// Execution
export {
  buildRecordData,
  buildMultipleRecordData,
  executeRow,
  executeBatch,
  executeStrategy,
  executePlan,
  updateJobProgress,
  markJobExecuting,
  markJobCompleted,
  markJobFailed,
  type ExecuteRowContext,
  type ExecuteBatchContext,
  type BatchRecord,
  type ExecuteStrategyContext,
  type StrategyExecutionResult,
  type ExecutePlanOptions,
} from './execution'

// Events (SSE)
export {
  type ImportEventType,
  type ImportEvent,
  type AnyImportEvent,
  type JobStatusEvent,
  type UploadProgressEvent,
  type ResolutionProgressEvent,
  type PlanningRowEvent,
  type PlanningProgressEvent,
  type PlanningCompleteEvent,
  type ExecutionProgressEvent,
  type ExecutionCompleteEvent,
  type ErrorEvent,
  type EventCallback,
  ImportEventPublisher,
  createEventPublisher,
  ImportEventSubscriber,
} from './events'

// Utilities
export {
  chunkArray,
  createThrottledProgress,
  createPercentageProgress,
  retryWithBackoff,
  type ProgressCallback,
  type RetryOptions,
} from './utils'

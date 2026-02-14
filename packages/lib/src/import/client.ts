// packages/lib/src/import/client.ts
// Client-safe exports for the import module (no database or server dependencies)

export {
  autoMapColumns,
  type ColumnAutoMapping,
  type ColumnHeader,
} from './fields/auto-map-columns'
export {
  getIdentifierOptions,
  type IdentifierOption,
} from './fields/get-identifier-options'
// Field utilities (pure functions, no server dependencies)
export {
  getImportableFields,
  getRequiredFields,
  type ImportableField,
} from './fields/get-importable-fields'
export { getValidResolutionTypes, suggestResolutionType } from './fields/suggest-resolution-type'
// Hashing utilities (pure functions)
export { countOccurrences, hashValue } from './hashing'
export type {
  BatchExecutionResult,
  ExecutionContext,
  ExecutionProgress,
  ExecutionResult,
  RowExecutionResult,
} from './types/execution'
// Types
export type {
  ImportJob,
  ImportJobStatus,
  ImportStatistics,
  MappableProperty,
  UniqueValueSummary,
} from './types/job'
export type {
  ColumnMapping,
  ImportJobProperty,
  ImportMapping,
  ImportMappingProperty,
} from './types/mapping'
export type {
  ImportPlan,
  ImportPlanRow,
  ImportPlanStatus,
  ImportPlanStrategy,
  PlanEstimates,
  PlanningProgress,
  RowAnalysis,
  StrategyStatistics,
  StrategyStatus,
  StrategyType,
} from './types/plan'
export type {
  ResolutionConfig,
  ResolutionResult,
  ResolutionType,
  ResolvedValue,
  UniqueValue,
  ValueResolution,
} from './types/resolution'

// Utilities (pure functions)
export { chunkArray, createPercentageProgress, createThrottledProgress } from './utils'

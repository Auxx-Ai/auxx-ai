// packages/lib/src/import/client.ts
// Client-safe exports for the import module (no database or server dependencies)

// Types
export type {
  ImportJobStatus,
  ImportJob,
  ImportStatistics,
  MappableProperty,
  UniqueValueSummary,
} from './types/job'

export type {
  ImportMapping,
  ImportMappingProperty,
  ImportJobProperty,
  ColumnMapping,
} from './types/mapping'

export type {
  ResolutionType,
  ResolutionConfig,
  ResolvedValue,
  ResolutionResult,
  ValueResolution,
  UniqueValue,
} from './types/resolution'

export type {
  ImportPlanStatus,
  StrategyStatus,
  StrategyType,
  ImportPlan,
  ImportPlanStrategy,
  PlanningProgress,
  StrategyStatistics,
  ImportPlanRow,
  PlanEstimates,
  RowAnalysis,
} from './types/plan'

export type {
  RowExecutionResult,
  BatchExecutionResult,
  ExecutionResult,
  ExecutionContext,
  ExecutionProgress,
} from './types/execution'

// Field utilities (pure functions, no server dependencies)
export {
  getImportableFields,
  getRequiredFields,
  type ImportableField,
} from './fields/get-importable-fields'

export {
  getIdentifierOptions,
  type IdentifierOption,
} from './fields/get-identifier-options'

export {
  autoMapColumns,
  type ColumnHeader,
  type ColumnAutoMapping,
} from './fields/auto-map-columns'

export { suggestResolutionType, getValidResolutionTypes } from './fields/suggest-resolution-type'

// Hashing utilities (pure functions)
export { hashValue, countOccurrences } from './hashing'

// Utilities (pure functions)
export { chunkArray, createThrottledProgress, createPercentageProgress } from './utils'

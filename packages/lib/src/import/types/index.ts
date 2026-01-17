// packages/lib/src/import/types/index.ts

export {
  type EntityDefinitionId,
  type EntityInstanceId,
  type FieldId,
  type ResourceId,
  isSystemModelType,
  isCustomEntityDefinitionId,
} from './identifiers'

export {
  type ImportJobStatus,
  type ImportJob,
  type ImportStatistics,
  type MappableProperty,
  type UniqueValueSummary,
} from './job'

export {
  type ImportMapping,
  type ImportMappingProperty,
  type ImportJobProperty,
  type ColumnMapping,
} from './mapping'

export {
  type ResolutionType,
  type ResolutionConfig,
  type ResolvedValue,
  type ResolutionResult,
  type ValueResolution,
  type UniqueValue,
  type OverrideValue,
  type ColumnFieldConfig,
} from './resolution'

export {
  type ImportPlanStatus,
  type StrategyStatus,
  type StrategyType,
  type ImportPlan,
  type ImportPlanStrategy,
  type PlanningProgress,
  type StrategyStatistics,
  type ImportPlanRow,
  type PlanEstimates,
  type RowAnalysis,
} from './plan'

export {
  type RowExecutionResult,
  type BatchExecutionResult,
  type ExecutionResult,
  type ExecutionContext,
  type ExecutionProgress,
} from './execution'

export {
  type AIColumnMappingInput,
  type AIColumnMappingResult,
  type AIColumnMappingResponse,
} from './ai-mapping'

// packages/lib/src/import/types/plan.ts

/** Import plan status */
export type ImportPlanStatus =
  | 'planning' // Analyzing rows
  | 'planned' // Analysis complete
  | 'executing' // Running import
  | 'completed' // Finished

/** Strategy status */
export type StrategyStatus =
  | 'planning_queued'
  | 'planning'
  | 'planned'
  | 'executing'
  | 'completed'

/** Strategy type */
export type StrategyType = 'create' | 'update' | 'skip'

/** Import plan record */
export interface ImportPlan {
  id: string
  importJobId: string
  status: ImportPlanStatus
  completedAt?: Date
  createdAt: Date
}

/** Strategy within a plan */
export interface ImportPlanStrategy {
  id: string
  importPlanId: string
  strategy: StrategyType
  matchingFieldKey: string | null
  matchingCustomFieldId: string | null
  status: StrategyStatus
  planningProgress?: PlanningProgress
  statistics?: StrategyStatistics
}

/** Planning progress tracking */
export interface PlanningProgress {
  total: number
  processed: number
  remaining: number
}

/** Strategy execution statistics */
export interface StrategyStatistics {
  planned: number
  executed?: number
  failed?: number
}

/** Row assignment within a strategy */
export interface ImportPlanRow {
  id: string
  importPlanStrategyId: string
  rowIndex: number
  existingRecordId?: string
  status: 'planned' | 'executing' | 'completed' | 'failed'
  resultRecordId?: string
  errorMessage?: string
  executedAt?: Date
}

/** Plan estimates summary */
export interface PlanEstimates {
  totalRows: number
  toCreate: number
  toUpdate: number
  toSkip: number
  withErrors: number
}

/** Row analysis result */
export interface RowAnalysis {
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  resolvedData: Record<string, unknown>
  errors: string[]
}

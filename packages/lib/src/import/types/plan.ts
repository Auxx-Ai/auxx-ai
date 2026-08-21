// packages/lib/src/import/types/plan.ts

/** Import plan status */
export type ImportPlanStatus =
  | 'planning' // Analyzing rows
  | 'planned' // Analysis complete
  | 'executing' // Running import
  | 'completed' // Finished

/** Strategy status */
export type StrategyStatus = 'planning_queued' | 'planning' | 'planned' | 'executing' | 'completed'

/**
 * Per-row strategy.
 *
 * `skip` and `unmatched` are NOT the same state and must never share a
 * badge. `skip` means *"this row has an error"*; `unmatched` means *"this row
 * is fine, but update-only mode found no record to update"*. Conflating them
 * hides a whole class of unimported rows behind a normal-looking preview.
 *
 * Neither is executed, both exist so every analyzed row lands in exactly one
 * strategy bucket and `sum(strategyCounts) === rawData.size` holds.
 */
export type StrategyType = 'create' | 'update' | 'skip' | 'unmatched'

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
  /** Non-fatal issues (dropped values, degraded strategy) — the row still imported */
  warningMessage?: string
  executedAt?: Date
}

/** Plan estimates summary */
export interface PlanEstimates {
  totalRows: number
  toCreate: number
  toUpdate: number
  /** Rows skipped because they carry an ERROR. */
  toSkip: number
  /** Rows skipped because update-only mode found no matching record. */
  toUnmatched: number
  withErrors: number
}

/** Row analysis result */
export interface RowAnalysis {
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  resolvedData: Record<string, unknown>
  errors: string[]
  /** Non-fatal issues (e.g. invalid split elements dropped) — the row still imports */
  warnings: string[]
}

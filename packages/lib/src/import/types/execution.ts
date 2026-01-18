// packages/lib/src/import/types/execution.ts

import type { Database } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import type { StrategyType } from './plan'

/** Single row execution result */
export interface RowExecutionResult {
  rowIndex: number
  success: boolean
  /** Instance ID of the created/updated record */
  instanceId?: string
  /** Full RecordId (entityDefinitionId:instanceId) - computed from context */
  recordId?: RecordId
  error?: string
}

/** Batch execution result */
export interface BatchExecutionResult {
  succeeded: number
  failed: number
  results: RowExecutionResult[]
}

/** Overall execution result */
export interface ExecutionResult {
  planId: string
  status: 'completed' | 'partial' | 'failed'
  /** Target entity definition for this import */
  entityDefinitionId?: string
  statistics: {
    created: number
    updated: number
    skipped: number
    failed: number
  }
  errors: Array<{
    rowIndex: number
    error: string
  }>
  durationMs: number
}

/** Execution context */
export interface ExecutionContext {
  db: Database
  organizationId: string
  userId: string
  /** Entity definition ID for the import target */
  entityDefinitionId: string
  onProgress?: (progress: ExecutionProgress) => void
}

/** Execution progress update */
export interface ExecutionProgress {
  phase: 'executing'
  strategyId: string
  strategy: StrategyType
  processed: number
  total: number
  succeeded: number
  failed: number
}

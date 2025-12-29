// packages/lib/src/import/types/execution.ts

import type { Database } from '@auxx/database'
import type { StrategyType } from './plan'

/** Single row execution result */
export interface RowExecutionResult {
  rowIndex: number
  success: boolean
  recordId?: string
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
  targetTable: string
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

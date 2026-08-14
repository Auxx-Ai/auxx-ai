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
  /** Non-fatal issue (value dropped on conflict, create degraded to update) — the row imported */
  warning?: string
}

/** Per-field write mode for the CRUD layer (multi fields append instead of whole-field set) */
export type FieldWriteModes = Record<string, 'set' | 'add' | 'remove'>

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
    /** Rows that imported with at least one warning */
    warnings: number
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

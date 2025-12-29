// packages/lib/src/import/events/event-types.ts

import type { ImportJobStatus, ImportStatistics } from '../types/job'
import type { StrategyType, PlanEstimates } from '../types/plan'
import type { ExecutionProgress } from '../types/execution'

/**
 * SSE event types for import progress
 */
export type ImportEventType =
  | 'job:status'
  | 'upload:progress'
  | 'resolution:progress'
  | 'planning:row'
  | 'planning:progress'
  | 'planning:complete'
  | 'execution:progress'
  | 'execution:complete'
  | 'error'

/** Base event structure */
export interface ImportEvent {
  type: ImportEventType
  timestamp: number
  jobId: string
}

/** Job status changed event */
export interface JobStatusEvent extends ImportEvent {
  type: 'job:status'
  status: ImportJobStatus
}

/** Upload progress event (chunked upload) */
export interface UploadProgressEvent extends ImportEvent {
  type: 'upload:progress'
  chunksReceived: number
  totalChunks: number
  rowsUploaded: number
  totalRows: number
}

/** Resolution progress event */
export interface ResolutionProgressEvent extends ImportEvent {
  type: 'resolution:progress'
  columnIndex: number
  columnName: string
  resolved: number
  total: number
  errorsFound: number
}

/** Planning row event (real-time row data for preview) */
export interface PlanningRowEvent extends ImportEvent {
  type: 'planning:row'
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  fields: Record<string, unknown>
  errors: string[]
}

/** Planning progress event */
export interface PlanningProgressEvent extends ImportEvent {
  type: 'planning:progress'
  phase: 'analyzing' | 'assigning'
  processed: number
  total: number
}

/** Planning complete event */
export interface PlanningCompleteEvent extends ImportEvent {
  type: 'planning:complete'
  estimates: PlanEstimates
}

/** Execution progress event */
export interface ExecutionProgressEvent extends ImportEvent {
  type: 'execution:progress'
  strategyId: string
  strategy: StrategyType
  processed: number
  total: number
  succeeded: number
  failed: number
}

/** Execution complete event */
export interface ExecutionCompleteEvent extends ImportEvent {
  type: 'execution:complete'
  statistics: ImportStatistics
  durationMs: number
}

/** Error event */
export interface ErrorEvent extends ImportEvent {
  type: 'error'
  message: string
  code?: string
}

/** Union of all event types */
export type AnyImportEvent =
  | JobStatusEvent
  | UploadProgressEvent
  | ResolutionProgressEvent
  | PlanningRowEvent
  | PlanningProgressEvent
  | PlanningCompleteEvent
  | ExecutionProgressEvent
  | ExecutionCompleteEvent
  | ErrorEvent

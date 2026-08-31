// packages/lib/src/import/types/job.ts

/** Import job status lifecycle */
export type ImportJobStatus =
  | 'uploading' // File being uploaded
  | 'ingesting' // Parsing file, storing raw data
  | 'waiting' // Waiting for user to complete mappings
  | 'planning' // Generating import plan
  | 'ready' // Plan complete, awaiting confirmation
  | 'executing' // Import in progress
  | 'completed' // Import finished, every row landed
  | 'completed_with_errors' // Import finished, but some rows failed
  | 'failed' // Import failed — ingestion threw, or every row failed
  | 'canceled' // User canceled

/** Import job record */
export interface ImportJob {
  id: string
  importMappingId: string
  organizationId: string
  sourceFileName: string
  columnCount: number
  rowCount: number
  totalChunks?: number
  receivedChunks: number
  status: ImportJobStatus
  ingestionFailureReason?: string
  allowPlanGeneration: boolean
  statistics?: ImportStatistics
  createdById?: string
  createdAt: Date
  confirmedAt?: Date
  startedExecutionAt?: Date
  completedAt?: Date
}

/** Import execution statistics */
export interface ImportStatistics {
  created: number
  updated: number
  /** Rows skipped because they carry an ERROR. */
  skipped: number
  /**
   * Rows skipped because update-only mode found no record to update.
   * Not an error, and never folded into `skipped`.
   *
   * Optional here and written by `executeImportPlan`; it was missing from this
   * type while being present on the row, so anything reading statistics through
   * `ImportStatistics` silently lost it.
   */
  unmatched?: number
  /** Update rows whose payload was empty — nothing written, not a failure. */
  noOps?: number
  failed: number
  /** Rows that imported with at least one warning */
  warnings?: number
  durationMs?: number
}

/** CSV column metadata */
export interface MappableProperty {
  id: string
  importJobId: string
  visibleName: string
  columnIndex: number
}

/** Unique value with occurrence count - used for smart value display */
export interface UniqueValueSummary {
  hash: string
  rawValue: string
  count: number // How many rows have this value
  isResolved: boolean
  resolutionStatus: 'pending' | 'valid' | 'error' | 'warning' | 'create'
  resolvedValue?: unknown
  errorMessage?: string
}

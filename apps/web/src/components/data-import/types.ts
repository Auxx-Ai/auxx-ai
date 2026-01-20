// apps/web/src/components/data-import/types.ts

import type { ReactNode } from 'react'
import type { SelectOption } from '@auxx/types/custom-field'

/** Wizard step identifiers */
export type ImportStep = 'upload' | 'map-columns' | 'review-values' | 'confirm'

/** Step status for UI display */
export type StepStatus = 'pending' | 'active' | 'complete' | 'error'

/** Step card data for StatCards component */
export interface ImportStepCardData {
  id: ImportStep
  title: string
  icon: ReactNode
  status: StepStatus
  body: string | number
  description: ReactNode
  isClickable: boolean
  color: string
}

/** Parsed CSV data (client-side) */
export interface ParsedCSVData {
  headers: ColumnHeader[]
  rows: string[][]
  rowCount: number
  columnCount: number
}

/** CSV column header */
export interface ColumnHeader {
  index: number
  name: string
}

/** Column mapping with UI state */
export interface ColumnMappingUI {
  id: string
  importMappingId: string
  sourceColumnIndex: number
  sourceColumnName: string
  columnName: string
  sampleValues: string[]
  targetType: 'skip' | 'particle' | 'custom_field'
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  /** For relationship fields - the field on the target resource to match by */
  matchField?: string | null
  createdAt: Date
  updatedAt: Date
  isMapped: boolean
  suggestedField: string | null
}

/** Override value for user corrections */
export interface OverrideValue {
  type: 'value' | 'create' | 'skip'
  value: string
  id?: string
}

/** Resolution status from auto-resolution */
export type ResolutionStatus = 'pending' | 'valid' | 'error' | 'warning' | 'create'

/** Effective status after user override (includes 'skip') */
export type EffectiveStatus = ResolutionStatus | 'skip'

/** Unique value summary from server */
export interface UniqueValueSummary {
  hash: string
  rawValue: string
  resolvedValue: string | null
  resolvedValues: Array<{ type: string; value?: unknown }>
  count: number
  originalStatus: ResolutionStatus // From auto-resolution, used for grouping
  effectiveStatus: EffectiveStatus // After override, used for display
  errorMessage?: string
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
}

/** Field configuration for value editing */
export interface ColumnFieldConfig {
  key: string
  type: string
  resolutionType: string
  options?: SelectOption[]
  relationConfig?: {
    relatedEntityDefinitionId: string
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  }
}

// Re-export ImportableField from the lib package
export type { ImportableField } from '@auxx/lib/import'

/** Upload progress state */
export interface UploadProgress {
  phase: 'idle' | 'parsing' | 'uploading' | 'complete' | 'error'
  parseProgress: number
  chunksUploaded: number
  totalChunks: number
  rowsUploaded: number
  totalRows: number
  error: string | null
}

/** Resolution progress state */
export interface ResolutionProgress {
  phase: 'idle' | 'resolving' | 'complete' | 'error'
  columnsProcessed: number
  totalColumns: number
  valuesProcessed: number
  totalValues: number
}

/** Execution progress state (from SSE) */
export interface ExecutionProgress {
  phase: 'idle' | 'resolving' | 'preparing' | 'executing' | 'complete' | 'error'
  currentStrategy: 'create' | 'update' | 'skip' | null
  rowsProcessed: number
  totalRows: number
  created: number
  updated: number
  skipped: number
  failed: number
}

/** SSE Resolution progress event data */
export interface SSEResolutionProgress {
  columnIndex: number
  columnName: string
  resolved: number
  total: number
  errorsFound: number
}

/** Plan estimates */
export interface PlanEstimates {
  totalRows: number
  toCreate: number
  toUpdate: number
  toSkip: number
  withErrors: number
}

/** Import plan */
export interface ImportPlan {
  id: string
  jobId: string
  status: string
  estimates: PlanEstimates
}

/** Step data for step cards */
export interface StepData {
  upload: { rowCount: number | null; fileName: string | null }
  'map-columns': { mappedCount: number; totalColumns: number }
  'review-values': { errorCount: number; warningCount: number }
  confirm: { toCreate: number; toUpdate: number; toSkip: number }
}

/** Mapped column info */
export interface MappedColumn {
  columnIndex: number
  columnName: string
  targetFieldKey: string | null
  uniqueCount: number
  errorCount: number
  warningCount?: number
}

/** Plan preview row (from SSE during planning) */
export interface PlanPreviewRow {
  /** Row index from original CSV (0-based) */
  rowIndex: number
  /** Determined strategy for this row */
  strategy: 'create' | 'update' | 'skip'
  /** ID of existing record (for update strategy) */
  existingRecordId?: string
  /** Resolved field values for display */
  fields: Record<string, unknown>
  /** Error messages (for skip strategy) */
  errors: string[]
}

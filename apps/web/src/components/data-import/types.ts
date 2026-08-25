// apps/web/src/components/data-import/types.ts

import type {
  EffectiveStatus,
  IdentityRole,
  ImportMergeStrategy,
  RelationCreateRequest,
  RelationLinkMode,
  RelationOnNoMatch,
  ResolutionStatus,
  StrategyType,
} from '@auxx/lib/import/client'
import type { SelectOption } from '@auxx/types/custom-field'
import type { ReactNode } from 'react'

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
  /** Only `skip` and `particle` are ever persisted (`save-mapping-property.ts`). */
  targetType: 'skip' | 'particle'
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  /** For relationship fields - the field on the target resource to match by */
  matchField?: string | null
  /**
   * The identity flag on this column. `{ kind: 'match' }` ⇒ it is (part of) the job's
   * match key. Per-COLUMN, but it moves `ImportMapping.identifierFieldKeys` and
   * `defaultStrategy`, which are per-JOB, so a write here always has to be
   * reconciled against the job read.
   */
  identityRole: IdentityRole | null
  /** Per-column write policy on the update path. Absent ⇒ `overwrite`. */
  mergeStrategy: ImportMergeStrategy | null
  /** Relation policy: what happens when the cell names a record that is absent. */
  onNoMatch: RelationOnNoMatch | null
  /** Relation policy: replace or append on the update path (multi-valued only). */
  linkMode: RelationLinkMode | null
  /**
   * Distinct raw values in THIS column of THIS file. `distinctValueCount <
   * totalValueCount` on a identifier column is the failure field-level `isUnique`
   * cannot see, values duplicated inside the upload create two records no
   * later import can ever match again.
   */
  distinctValueCount: number
  /** Total cells stored for this column (blank cells included). */
  totalValueCount: number
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

/**
 * Resolution status, and the effective status after a user override.
 *
 * Re-exported from lib rather than restated: `deriveEffectiveStatus` runs on
 * both sides of the wire, so the two must be the same union.
 */
export type { EffectiveStatus, ResolutionStatus }

/** Unique value summary from server */
export interface UniqueValueSummary {
  hash: string
  rawValue: string
  resolvedValue: string | null
  /**
   * Display label(s) behind `resolvedValue` for option columns, resolved
   * server-side against the LIVE option list. Null for non-option columns and
   * for pending option creates (their `resolvedValue` is a label, not a key).
   */
  resolvedLabel: string | null
  resolvedValues: Array<{ type: string; value?: unknown }>
  count: number
  originalStatus: ResolutionStatus // From auto-resolution, used for grouping
  effectiveStatus: EffectiveStatus // After override, used for display
  errorMessage: string | null
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
  /**
   * Present when `originalStatus === 'create'` on a RELATION column, what will
   * be minted if the import runs. Nothing is written until execution, so this
   * is the only description the review step has of a pending create.
   */
  relationCreate?: RelationCreateRequest
}

/**
 * Field configuration for value editing.
 *
 * No `relationConfig`: the review step edits a relation column through a plain
 * text box, so the copy that used to ride here had no consumer.
 */
export interface ColumnFieldConfig {
  key: string
  type: string
  resolutionType: string
  /** `ImportMappingProperty.customFieldId` — null for system fields */
  customFieldId?: string | null
  /** `ImportMapping.entityDefinitionId` — the resource this column targets */
  entityDefinitionId?: string
  options?: SelectOption[]
}

// Re-export ImportableField from the lib package's CLIENT barrel, the server
// barrel pulls in Drizzle and bullmq, which the wizard must never reach.
export type { FieldGroup, ImportableField } from '@auxx/lib/import/client'

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
  /** Rows that imported with at least one warning */
  warnings: number
}

/** SSE Resolution progress event data */
export interface SSEResolutionProgress {
  columnIndex: number
  columnName: string
  resolved: number
  total: number
  errorsFound: number
}

/**
 * Plan estimates.
 *
 * `toSkip` and `toUnmatched` are NOT the same outcome. `toSkip` counts rows
 * carrying an ERROR; `toUnmatched` counts rows that are perfectly fine but that
 * update-only mode found no record to update. Neither is imported, and folding
 * them into one number hides the second entirely.
 */
export interface PlanEstimates {
  totalRows: number
  toCreate: number
  toUpdate: number
  /** Rows skipped because they carry an error. */
  toSkip: number
  /** Rows skipped because update-only mode found no matching record. */
  toUnmatched: number
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
  confirm: { toCreate: number; toUpdate: number; toSkip: number; toUnmatched: number }
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
  /** Determined strategy for this row, four outcomes, not three. */
  strategy: StrategyType
  /** ID of existing record (for update strategy) */
  existingRecordId?: string
  /** Resolved field values for display */
  fields: Record<string, unknown>
  /** Error messages (for skip strategy) */
  errors: string[]
  /** Non-fatal warnings — the row still imports */
  warnings?: string[]
}

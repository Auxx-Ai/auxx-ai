// apps/web/src/components/data-import/plan-preview/types.ts

import type { StrategyType } from '@auxx/lib/import'

/**
 * Row data for plan preview table.
 * Used both for SSE streaming during planning and DB hydration after refresh.
 */
export interface PlanPreviewRow {
  /** Row index from original CSV (0-based) */
  rowIndex: number
  /** Determined strategy for this row */
  strategy: StrategyType
  /** ID of existing record (for update strategy) */
  existingRecordId?: string
  /** Resolved field values for display */
  fields: Record<string, unknown>
  /** Error messages (for skip strategy) - from SSE */
  errors?: string[]
  /** Single error message - from DB query */
  errorMessage?: string
  /** Row execution status */
  status?: 'planned' | 'executing' | 'completed' | 'failed'
}

/**
 * Strategy counts for footer display
 */
export interface StrategyCounts {
  create: number
  update: number
  skip: number
}

/**
 * Mapping property for column generation
 */
export interface PreviewColumnMapping {
  sourceColumnIndex: number
  sourceColumnName?: string
  targetFieldKey: string | null
  targetFieldLabel?: string
  targetType?: string
  fieldType?: string
}

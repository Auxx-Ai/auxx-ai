// apps/web/src/components/data-import/plan-preview/types.ts

import type { StrategyType } from '@auxx/lib/import/client'

/** A saved plan row, as the preview table lists it. */
export interface PlanPreviewRow {
  /** Row index from original CSV (0-based) */
  rowIndex: number
  /** Determined strategy for this row */
  strategy: StrategyType
  /** ID of existing record (for update strategy) */
  existingRecordId?: string
  /** Resolved field values for display */
  fields: Record<string, unknown>
  /** Error messages (for skip strategy) */
  errors?: string[]
  /** Single error message, as stored on the plan row */
  errorMessage?: string
  /** Non-fatal warnings — the row still imports */
  warnings?: string[]
  /** Single warning message, as stored on the plan row */
  warningMessage?: string
  /** Row execution status */
  status?: 'planned' | 'executing' | 'completed' | 'failed'
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
  /** The target field's storage type (`FieldType`), decides the cell renderer */
  fieldType?: string
  /** CURRENCY targets: what the resolved minor units are denominated in, and the field's precision */
  currencyCode?: string
  decimals?: number
}

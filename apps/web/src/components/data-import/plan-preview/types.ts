// apps/web/src/components/data-import/plan-preview/types.ts

import type { StrategyType } from '@auxx/lib/import/client'

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
  /** Non-fatal warnings — the row still imports */
  warnings?: string[]
  /** Single warning message - from DB query */
  warningMessage?: string
  /** Row execution status */
  status?: 'planned' | 'executing' | 'completed' | 'failed'
}

/**
 * Strategy counts for footer display.
 *
 * Keyed by the full {@link StrategyType} union so a new outcome cannot be
 * counted into nothing. `unmatched` is a separate bucket from `skip`, a row
 * with no error that update-only mode had nothing to update.
 */
export type StrategyCounts = Record<StrategyType, number>

/** Every bucket at zero, the reduce seed, and the shape of "nothing planned". */
export const EMPTY_STRATEGY_COUNTS: StrategyCounts = {
  create: 0,
  update: 0,
  skip: 0,
  unmatched: 0,
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

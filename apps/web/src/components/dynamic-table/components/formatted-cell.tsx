// apps/web/src/components/dynamic-table/components/formatted-cell.tsx

'use client'

import { memo } from 'react'
import { useTableConfig } from '../context/table-config-context'
import { useColumnFormatting } from '../stores/store-selectors'
import type { ColumnFormatting } from '../types'
import { renderCellValue } from '../utils/cell-renderers'

/**
 * Config for field-specific data passed to renderers.
 * Display options (decimals, format, displayAs, currencyCode, etc.) are read
 * from the options object directly (flat structure) as fallback when no column
 * formatting is specified.
 */
export interface CellConfig {
  /** Field options - select options array OR flat display options (decimals, format, currencyCode, …) */
  options?: Record<string, unknown>
  /** Items for ItemsCellView (groups, sources, etc.) */
  items?: Array<{ id: string; [key: string]: unknown }>
  /** Render function for ItemsCellView */
  renderItem?: (item: any, index: number) => React.ReactNode
  /** Empty content for ItemsCellView */
  emptyContent?: React.ReactNode
  /**
   * When true, RELATIONSHIP renderers render their record badges with
   * `hoverCard={false}` to prevent nested hover cards. Set by callers that
   * are themselves inside a hover card (e.g. `RecordHoverCardField`).
   */
  disableNestedHoverCard?: boolean
}

/**
 * Props for the FormattedCell component
 * Config props (options, items, renderItem, etc.) are passed directly
 */
interface FormattedCellProps extends CellConfig {
  /** The value to render */
  value: unknown
  /** Field type for determining renderer */
  fieldType?: string
  /** Column ID for looking up formatting from context */
  columnId?: string
  /** Explicit formatting to apply (takes precedence over context formatting) */
  formatting?: ColumnFormatting
  /** True when value comes from a field path (relationship traversal) */
  isFieldPath?: boolean
}

/**
 * Universal cell renderer — single entry point for ALL cell types.
 * Routes to the appropriate renderer based on fieldType. Each renderer wraps
 * its output in ExpandableCell, which owns padding, row height, and the
 * expand-on-select behavior.
 *
 * Memoized to prevent unnecessary re-renders when parent cell updates.
 */
export const FormattedCell = memo(function FormattedCell({
  value,
  fieldType,
  columnId,
  formatting: explicitFormatting,
  ...config
}: FormattedCellProps) {
  const type = fieldType ?? 'TEXT'

  // Get formatting from store if available, explicit formatting takes precedence
  let formatting: ColumnFormatting | undefined = explicitFormatting

  if (!formatting && columnId) {
    try {
      const { tableId } = useTableConfig()
      const columnFormatting = useColumnFormatting(tableId)

      if (columnFormatting?.[columnId]) {
        formatting = columnFormatting[columnId]
      }
    } catch {
      // Context not available (e.g., in tests or outside table), use defaults
    }
  }

  return <>{renderCellValue(value, type, formatting, config)}</>
})

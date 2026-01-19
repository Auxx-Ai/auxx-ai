// apps/web/src/components/dynamic-table/components/formatted-cell.tsx

'use client'

import { memo } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { useTableConfig } from '../context/table-config-context'
import { useColumnFormatting } from '../stores/store-selectors'
import { renderCellValue } from '../utils/cell-renderers'
import { ExpandableCell } from './expandable-cell'
import { ItemsCellView } from '~/components/ui/items-list-view'
import type { ColumnFormatting } from '../types'
import type { CurrencyDisplayOptions } from '@auxx/utils'

/**
 * Field types that already handle array values internally.
 * These should NOT be wrapped in ItemsCellView when value is array.
 */
const MULTI_VALUE_FIELD_TYPES = new Set([
  'TAGS',
  'MULTI_SELECT',
  'RELATIONSHIP',
  'ITEMS',
])

/**
 * Config for field-specific data passed to renderers.
 * Display options (decimals, format, displayAs, etc.) are read from the
 * options object directly (flat structure) as fallback when no column
 * formatting is specified.
 */
export interface CellConfig {
  /** Field options - contains select options array OR flat display options (decimals, format, etc.) */
  options?: Record<string, unknown>
  /** Currency display options (from field.options.currency) */
  currency?: CurrencyDisplayOptions
  /** Items for ItemsCellView (groups, sources, etc.) */
  items?: Array<{ id: string; [key: string]: unknown }>
  /** Render function for ItemsCellView */
  renderItem?: (item: any, index: number) => React.ReactNode
  /** Empty content for ItemsCellView */
  emptyContent?: React.ReactNode
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
  /** Additional className for the wrapper */
  className?: string
  /** True when value comes from a field path (relationship traversal) */
  isFieldPath?: boolean
}

/**
 * Universal cell renderer - single entry point for ALL cell types.
 *
 * Each renderer handles its own padding via CellPadding internally.
 * This component just routes to the appropriate renderer based on fieldType.
 *
 * For field paths (relationship traversal), handles array values:
 * - Multi-value field types (TAGS, MULTI_SELECT, RELATIONSHIP) handle arrays internally
 * - Other field types get wrapped in ItemsCellView to display each item
 *
 * Memoized to prevent unnecessary re-renders when parent cell updates.
 *
 * Usage:
 * ```tsx
 * // Standard fields
 * <FormattedCell value={email} fieldType="EMAIL" />
 *
 * // Tags/Select with options
 * <FormattedCell value={tagIds} fieldType="TAGS" options={options} />
 *
 * // Field path with potential array values
 * <FormattedCell value={vendorNames} fieldType="TEXT" isFieldPath />
 * ```
 */
export const FormattedCell = memo(function FormattedCell({
  value,
  fieldType,
  columnId,
  formatting: explicitFormatting,
  className,
  isFieldPath = false,
  ...config
}: FormattedCellProps) {
  const type = fieldType ?? 'TEXT'

  // Get formatting from store if available, explicit formatting takes precedence
  let formatting: ColumnFormatting | undefined = explicitFormatting

  if (!formatting && columnId) {
    try {
      // Try to get tableId from config context and use granular selector
      const { tableId } = useTableConfig()
      const columnFormatting = useColumnFormatting(tableId)

      if (columnFormatting?.[columnId]) {
        formatting = columnFormatting[columnId]
      }
    } catch {
      // Context not available (e.g., in tests or outside table), use defaults
    }
  }

  // Check if value is an array that needs special handling
  // (path results can return arrays for non-multi-value field types)
  const isArrayValue = Array.isArray(value)
  const fieldHandlesArrays = MULTI_VALUE_FIELD_TYPES.has(type)

  // If array value AND field type doesn't handle arrays → wrap in ItemsCellView
  if (isArrayValue && !fieldHandlesArrays && value.length > 0) {
    return (
      <ItemsCellView
        items={value.map((v, i) => ({ id: String(i), value: v }))}
        renderItem={(item) => renderCellValue(item.value, type, formatting, config)}
      />
    )
  }

  // Standard rendering (single value or field that handles arrays)
  return <>{renderCellValue(value, type, formatting, config)}</>
})

/**
 * Padding wrapper for custom cell content with expand-on-selection.
 * - Collapsed: Shows truncated content within cell bounds
 * - Selected: Expands to show full content in overlay
 *
 * Memoized to prevent unnecessary re-renders.
 */
export const CellPadding = memo(function CellPadding({
  children,
  className,
  expandDirection,
}: {
  children: React.ReactNode
  className?: string
  /** 'both' for text (wraps), 'horizontal' for numbers (no wrap) */
  expandDirection?: 'both' | 'horizontal'
}) {
  return (
    <ExpandableCell expandDirection={expandDirection}>
      <div className={cn('text-sm cursor-default w-full pl-3 pr-2', className)}>{children}</div>
    </ExpandableCell>
  )
})

// apps/web/src/components/dynamic-table/components/formatted-cell.tsx

'use client'

import { memo } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { useTableContext } from '../context/table-context'
import { renderCellValue } from '../utils/cell-renderers'
import { ExpandableCell } from './expandable-cell'
import type { ColumnFormatting } from '../types'
import type { CurrencyDisplayOptions } from '@auxx/lib/utils'

/**
 * Config for field-specific data passed to renderers
 */
export interface CellConfig {
  /** Field options - select options array or full field.options object */
  options?: unknown
  /** Currency display options */
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
  fieldType: string
  /** Column ID for looking up formatting from context */
  columnId?: string
  /** Explicit formatting to apply (takes precedence over context formatting) */
  formatting?: ColumnFormatting
  /** Additional className for the wrapper */
  className?: string
}

/**
 * Universal cell renderer - single entry point for ALL cell types.
 *
 * Each renderer handles its own padding via CellPadding internally.
 * This component just routes to the appropriate renderer based on fieldType.
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
 * // Custom items list
 * <FormattedCell
 *   value={null}
 *   fieldType="ITEMS"
 *   items={items}
 *   renderItem={(g) => <Badge>{g.name}</Badge>}
 * />
 * ```
 */
export const FormattedCell = memo(function FormattedCell({
  value,
  fieldType,
  columnId,
  formatting: explicitFormatting,
  className,
  ...config
}: FormattedCellProps) {
  // Get formatting from context if available, explicit formatting takes precedence
  let formatting: ColumnFormatting | undefined = explicitFormatting

  if (!formatting) {
    try {
      const context = useTableContext()
      if (columnId && context.columnFormatting?.[columnId]) {
        formatting = context.columnFormatting[columnId]
      }
    } catch {
      // Context not available (e.g., in tests or outside table), use defaults
    }
  }

  // Renderers handle their own padding via CellPadding
  return <>{renderCellValue(value, fieldType, formatting, config)}</>
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

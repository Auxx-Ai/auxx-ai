// apps/web/src/components/dynamic-table/components/expandable-cell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { CellSelectionOverlay } from './cell-selection-overlay'

interface ExpandableCellProps {
  children: React.ReactNode
  className?: string
  /**
   * Expand direction when selected:
   * - 'both': Expands horizontally and wraps vertically (default, for TEXT)
   * - 'horizontal': Only expands to the right, no wrapping (for NUMBER, CURRENCY, etc.)
   */
  expandDirection?: 'both' | 'horizontal'
}

/**
 * Wrapper that expands cell content when selected.
 * - Collapsed: Shows truncated content within cell bounds
 * - Selected: Expands to show full content in overlay
 *
 * Follows ItemsCellView pattern with data-self-overlay.
 */
export function ExpandableCell({
  children,
  className,
  expandDirection = 'both',
}: ExpandableCellProps) {
  const isHorizontalOnly = expandDirection === 'horizontal'

  return (
    <div
      data-slot="expandable-cell"
      className={cn('relative min-w-full w-full min-h-9 flex text-sm')}>
      {/* Collapsed view - truncated */}
      <div
        className={cn('flex items-center w-full overflow-hidden text-ellipsis whitespace-nowrap')}>
        {children}
      </div>

      {/* Expanded view - shows full content when cell is selected */}
      <div
        data-self-overlay
        className={cn(
          'absolute left-0 top-0 z-15 min-h-9',
          'hidden [.cell-selected_&]:flex',
          '[.cell-editing_&]:hidden',
          'min-w-full w-max bg-primary-100',
          isHorizontalOnly
            ? // Horizontal only: same height, no wrap, just extends right
              'items-center whitespace-nowrap'
            : // Both directions: wraps text, expands down
              'items-start pt-[8px] pb-[4px] max-w-[280px] [&>*]:whitespace-pre-wrap [&>*]:break-words'
        )}>
        <CellSelectionOverlay isSelected isEditing={false} />
        {children}
      </div>
    </div>
  )
}

// apps/web/src/components/dynamic-table/components/virtual-table-row.tsx

'use client'

import { type Row } from '@tanstack/react-table'
import { type VirtualItem, type Virtualizer } from '@tanstack/react-virtual'
import { useCallback, memo } from 'react'
import { VirtualTableCell } from './virtual-table-cell'
import { SelectableTableCell } from './selectable-table-cell'
import { cn } from '@auxx/ui/lib/utils'
import { ROW_HEIGHT } from '../utils/constants'

interface VirtualTableRowProps<TData> {
  row: Row<TData>
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  onRowClick?: (row: TData, event: React.MouseEvent, rowId: string) => void
  rowClassName?: (row: TData) => string | undefined
  isLastClicked?: boolean
  /** Pre-computed selection state to avoid context re-renders */
  isSelected?: boolean
  /** Getter for bulk mode - stable reference to avoid row re-renders */
  getIsBulkMode?: () => boolean
  /** Whether checkboxes are enabled - passed as prop to avoid context re-renders */
  enableCheckbox?: boolean
  /** Toggle row selection handler - passed as prop to avoid context re-renders */
  toggleRowSelection?: (rowId: string, event: React.MouseEvent) => void
  /** Drag attributes for drag-and-drop functionality */
  dragAttributes?: Record<string, any>
  /** Whether this row is currently being dragged */
  isDragging?: boolean
  /** Whether this row is a valid drop target */
  isDropTarget?: boolean
  isOver?: boolean
  style?: React.CSSProperties
  /** Ref to merge with the virtualizer measurement ref */
  ref?: React.Ref<HTMLDivElement>
  /** Whether cell selection is enabled - passed as prop to avoid context re-renders */
  cellSelectionEnabled?: boolean
}

const CELL_DEFAULT =
  'group/tablecell h-full bg-primary-50/80 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'

const CELL_SELECTED =
  'bg-blue-50 dark:bg-blue-950 group-hover/tablerow:bg-blue-100 dark:group-hover/tablerow:bg-blue-900'
const CELL_LAST_CLICKED = 'bg-primary-150 group-hover/tablerow:bg-primary-200'
/**
 * Individual virtualized table row component
 * Memoized to prevent unnecessary re-renders when parent updates
 */
function VirtualTableRowInner<TData>({
  row,
  virtualRow,
  rowVirtualizer,
  onRowClick,
  rowClassName,
  isLastClicked = false,
  isSelected = false,
  getIsBulkMode,
  enableCheckbox = false,
  toggleRowSelection,
  dragAttributes,
  isDragging = false,
  isDropTarget = false,
  isOver = false,
  style,
  ref,
  cellSelectionEnabled = false,
}: VirtualTableRowProps<TData>) {
  // Get bulk mode from getter - called at render time, not passed as prop
  const isBulkMode = getIsBulkMode?.() ?? false

  // Cache visible cells to avoid calling getVisibleCells() twice
  const visibleCells = row.getVisibleCells()
  const pinnedLeftCells = visibleCells.filter((cell) => cell.column.getIsPinned() === 'left')
  const unpinnedCells = visibleCells.filter((cell) => !cell.column.getIsPinned())

  // Enhanced row click handler that supports bulk mode
  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking on interactive elements
    const target = e.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('[role="checkbox"]')
    ) {
      return
    }

    // Read bulk mode at click time (not render time) to avoid stale closure
    const currentIsBulkMode = getIsBulkMode?.() ?? false

    // In bulk mode with checkboxes enabled, toggle row selection
    if (currentIsBulkMode && enableCheckbox) {
      toggleRowSelection?.(row.id, e)
    }

    // Always call the original onRowClick with enhanced parameters
    onRowClick?.(row.original, e, row.id)
  }

  // Merge the external ref with the virtualizer measurement ref
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Call the virtualizer measurement function
      rowVirtualizer.measureElement(node)

      // Call the external ref if provided
      if (ref) {
        if (typeof ref === 'function') {
          ref(node)
        } else {
          ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }
      }
    },
    [rowVirtualizer, ref]
  )

  if (!style) {
    style = {
      top: `${virtualRow.start}px`, // position the row based on virtualizer
      width: '100%',
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
    }
  }

  return (
    <div
      ref={mergedRef}
      data-index={virtualRow.index} // needed for dynamic row height measurement
      className="absolute w-full"
      style={style}>
      <div
        data-state={isSelected && 'selected'}
        aria-selected={isSelected}
        className={cn(
          'flex group/tablerow w-full  border-y border-background  rounded-md',
          'bg-primary-50 dark:bg-background hover:bg-primary-150/80 dark:hover:bg-primary-50/80',
          // 'will-change-transform',
          isSelected &&
            'bg-accent-50  hover:bg-accent-100 dark:bg-accent-50 dark:hover:bg-accent-100',
          isLastClicked && 'bg-primary-150 hover:bg-primary-200 ',
          isDragging && 'opacity-50',
          isBulkMode && enableCheckbox && 'cursor-pointer', // Add bulk mode cursor
          dragAttributes && 'cursor-move', // Add drag cursor when draggable
          rowClassName?.(row.original)
        )}
        style={{
          width: '100%',
          // contain: 'paint',
          minHeight: ROW_HEIGHT,
          height: ROW_HEIGHT,
        }}
        onClick={handleRowClick}
        {...dragAttributes}>
        {isDropTarget && (
          <div
            className={cn(
              'border-blue-500 rounded-md border-dashed border inset-x-1 inset-y-0 absolute pointer-events-none z-30',
              isOver && 'bg-info/10'
            )}
          />
        )}

        {/* Render left pinned cells */}
        {pinnedLeftCells.map((cell) => (
          <div
            key={cell.id}
            className={cn('sticky z-19')}
            style={{ left: cell.column.getStart('left') }}>
            {cellSelectionEnabled ? (
              <SelectableTableCell
                cell={cell}
                rowId={row.id}
                columnId={cell.column.id}
                className={cn(
                  CELL_DEFAULT,
                  'backdrop-blur-sm',
                  isSelected && CELL_SELECTED,
                  isLastClicked && CELL_LAST_CLICKED
                )}
              />
            ) : (
              <VirtualTableCell
                cell={cell}
                columnId={cell.column.id}
                className={cn(
                  CELL_DEFAULT,
                  'backdrop-blur-sm',
                  isSelected && CELL_SELECTED,
                  isLastClicked && CELL_LAST_CLICKED
                )}
              />
            )}
          </div>
        ))}

        {/* Render non-pinned cells */}
        {unpinnedCells.map((cell) =>
          cellSelectionEnabled ? (
            <SelectableTableCell
              key={cell.id}
              cell={cell}
              rowId={row.id}
              columnId={cell.column.id}
              className={cn(
                CELL_DEFAULT,
                isSelected && CELL_SELECTED,
                isLastClicked && CELL_LAST_CLICKED
              )}
            />
          ) : (
            <VirtualTableCell
              key={cell.id}
              cell={cell}
              columnId={cell.column.id}
              className={cn(
                CELL_DEFAULT,
                isSelected && CELL_SELECTED,
                isLastClicked && CELL_LAST_CLICKED
              )}
            />
          )
        )}
      </div>
    </div>
  )
}

/**
 * Custom comparator for VirtualTableRow memo
 * Only compares props that actually affect rendering, avoiding unnecessary re-renders
 */
function areRowPropsEqual<TData>(
  prevProps: VirtualTableRowProps<TData>,
  nextProps: VirtualTableRowProps<TData>
): boolean {
  // Compare row identity
  if (prevProps.row.id !== nextProps.row.id) return false

  // Compare selection state (passed as prop)
  if (prevProps.isSelected !== nextProps.isSelected) return false

  // Note: isBulkMode is now accessed via getter, not compared as prop
  if (prevProps.enableCheckbox !== nextProps.enableCheckbox) return false

  // Compare last clicked state
  if (prevProps.isLastClicked !== nextProps.isLastClicked) return false

  // Compare drag state
  if (prevProps.isDragging !== nextProps.isDragging) return false
  if (prevProps.isDropTarget !== nextProps.isDropTarget) return false
  if (prevProps.isOver !== nextProps.isOver) return false

  // Compare virtualRow position
  if (prevProps.virtualRow.index !== nextProps.virtualRow.index) return false
  if (prevProps.virtualRow.start !== nextProps.virtualRow.start) return false

  // Compare cell selection
  if (prevProps.cellSelectionEnabled !== nextProps.cellSelectionEnabled) return false

  return true
}

/** Memoized VirtualTableRow - only re-renders when props actually change */
export const VirtualTableRow = memo(VirtualTableRowInner) as typeof VirtualTableRowInner

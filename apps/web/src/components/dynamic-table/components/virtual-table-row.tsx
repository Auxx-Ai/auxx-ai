// apps/web/src/components/dynamic-table/components/virtual-table-row.tsx

'use client'

import { type Row } from '@tanstack/react-table'
import { type VirtualItem, type Virtualizer } from '@tanstack/react-virtual'
import { useCallback, memo } from 'react'
import { VirtualTableCell } from './virtual-table-cell'
import { SelectableTableCell } from './selectable-table-cell'
import { cn } from '@auxx/ui/lib/utils'
import { ROW_HEIGHT } from '../utils/constants'

const CELL_DEFAULT =
  'group/tablecell h-full bg-primary-50/80 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'
const CELL_SELECTED =
  'bg-blue-50 dark:bg-blue-950 group-hover/tablerow:bg-blue-100 dark:group-hover/tablerow:bg-blue-900'
const CELL_LAST_CLICKED = 'bg-primary-150 group-hover/tablerow:bg-primary-200'

interface VirtualTableRowProps<TData> {
  row: Row<TData>
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  onRowClick?: (row: TData, event: React.MouseEvent, rowId: string) => void
  rowClassName?: (row: TData) => string | undefined
  isLastClicked?: boolean
  isSelected?: boolean
  getIsBulkMode?: () => boolean
  enableCheckbox?: boolean
  toggleRowSelection?: (rowId: string, event: React.MouseEvent) => void
  dragAttributes?: Record<string, any>
  isDragging?: boolean
  isDropTarget?: boolean
  isOver?: boolean
  style?: React.CSSProperties
  ref?: React.Ref<HTMLDivElement>
  cellSelectionEnabled?: boolean
  /** Column signature - triggers re-render when column config changes */
  columnSignature?: string
}

/**
 * Virtualized table row component.
 * Memoized with custom comparator that includes columnSignature.
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
  const isBulkMode = getIsBulkMode?.() ?? false

  // Get cells - this now re-runs when columnSignature changes (via memo)
  const visibleCells = row.getVisibleCells()
  const pinnedLeftCells = visibleCells.filter((cell) => cell.column.getIsPinned() === 'left')
  const unpinnedCells = visibleCells.filter((cell) => !cell.column.getIsPinned())

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('[role="checkbox"]')
      ) {
        return
      }

      const currentIsBulkMode = getIsBulkMode?.() ?? false
      if (currentIsBulkMode && enableCheckbox) {
        toggleRowSelection?.(row.id, e)
      }

      onRowClick?.(row.original, e, row.id)
    },
    [row.id, row.original, getIsBulkMode, enableCheckbox, toggleRowSelection, onRowClick]
  )

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      rowVirtualizer.measureElement(node)
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
      top: `${virtualRow.start}px`,
      width: '100%',
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
    }
  }

  const cellClassName = cn(CELL_DEFAULT, isSelected && CELL_SELECTED, isLastClicked && CELL_LAST_CLICKED)
  const pinnedCellClassName = cn(cellClassName, 'backdrop-blur-sm')

  return (
    <div
      ref={mergedRef}
      data-index={virtualRow.index}
      className="absolute w-full"
      style={style}>
      <div
        data-state={isSelected && 'selected'}
        aria-selected={isSelected}
        className={cn(
          'flex group/tablerow w-full border-y border-background rounded-md',
          'bg-primary-50 dark:bg-background hover:bg-primary-150/80 dark:hover:bg-primary-50/80',
          isSelected && 'bg-accent-50 hover:bg-accent-100 dark:bg-accent-50 dark:hover:bg-accent-100',
          isLastClicked && 'bg-primary-150 hover:bg-primary-200',
          isDragging && 'opacity-50',
          isBulkMode && enableCheckbox && 'cursor-pointer',
          dragAttributes && 'cursor-move',
          rowClassName?.(row.original)
        )}
        style={{
          width: '100%',
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

        {/* Pinned left cells */}
        {pinnedLeftCells.map((cell) => (
          <div
            key={cell.id}
            className="sticky z-19"
            style={{ left: cell.column.getStart('left') }}>
            {cellSelectionEnabled ? (
              <SelectableTableCell
                cell={cell}
                rowId={row.id}
                columnId={cell.column.id}
                className={pinnedCellClassName}
              />
            ) : (
              <VirtualTableCell cell={cell} columnId={cell.column.id} className={pinnedCellClassName} />
            )}
          </div>
        ))}

        {/* Unpinned cells */}
        {unpinnedCells.map((cell) =>
          cellSelectionEnabled ? (
            <SelectableTableCell
              key={cell.id}
              cell={cell}
              rowId={row.id}
              columnId={cell.column.id}
              className={cellClassName}
            />
          ) : (
            <VirtualTableCell key={cell.id} cell={cell} columnId={cell.column.id} className={cellClassName} />
          )
        )}
      </div>
    </div>
  )
}

/**
 * Custom memo comparator - includes columnSignature for column reactivity
 */
function areRowPropsEqual<TData>(
  prevProps: VirtualTableRowProps<TData>,
  nextProps: VirtualTableRowProps<TData>
): boolean {
  // Column signature changed - must re-render for column config changes
  if (prevProps.columnSignature !== nextProps.columnSignature) return false

  // Row identity
  if (prevProps.row.id !== nextProps.row.id) return false

  // Selection state
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.enableCheckbox !== nextProps.enableCheckbox) return false
  if (prevProps.isLastClicked !== nextProps.isLastClicked) return false

  // Drag state
  if (prevProps.isDragging !== nextProps.isDragging) return false
  if (prevProps.isDropTarget !== nextProps.isDropTarget) return false
  if (prevProps.isOver !== nextProps.isOver) return false

  // Virtual position
  if (prevProps.virtualRow.index !== nextProps.virtualRow.index) return false
  if (prevProps.virtualRow.start !== nextProps.virtualRow.start) return false

  // Cell selection
  if (prevProps.cellSelectionEnabled !== nextProps.cellSelectionEnabled) return false

  return true
}

/** Memoized VirtualTableRow with column signature support */
export const VirtualTableRow = memo(VirtualTableRowInner, areRowPropsEqual) as typeof VirtualTableRowInner

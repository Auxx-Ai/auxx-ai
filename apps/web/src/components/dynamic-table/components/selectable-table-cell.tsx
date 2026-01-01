// apps/web/src/components/dynamic-table/components/selectable-table-cell.tsx
'use client'

import { memo } from 'react'
import { flexRender, type Cell } from '@tanstack/react-table'
import { cn } from '@auxx/ui/lib/utils'
import { useCellSelection } from '../context/cell-selection-context'
import { CellSelectionOverlay } from './cell-selection-overlay'
import { CellFieldEditor } from './cell-field-editor'
import { useCallback, useRef } from 'react'

interface SelectableTableCellProps<TData> {
  cell: Cell<TData, unknown>
  rowId: string
  /** Column ID for CSS variable width - uses data-col attribute */
  columnId: string
  className?: string
}

/**
 * Table cell with selection support - simple container with selection concerns
 *
 * Cell renderers (FormattedCell, ItemsCellView, custom components) handle
 * their own padding and layout. This component provides:
 * - Selection state management (single click to select)
 * - Edit mode (double click or Enter to edit)
 * - Selection overlay rendering
 * - Cell field editor (popover) when editing
 *
 * PERFORMANCE: Memoized to prevent unnecessary re-renders when parent row updates.
 * Only 1 CellFieldEditor renders at a time (for the editing cell).
 */
function SelectableTableCellInner<TData>({
  cell,
  rowId,
  columnId,
  className,
}: SelectableTableCellProps<TData>) {
  const { selectedCell, setSelectedCell, editingCell, setEditingCell, cellSelectionConfig } =
    useCellSelection()

  const cellRef = useRef<HTMLDivElement>(null)

  const isSelected = selectedCell?.rowId === rowId && selectedCell?.columnId === columnId
  const isEditing = editingCell?.rowId === rowId && editingCell?.columnId === columnId

  // System columns (checkbox) don't support selection
  const isSystemColumn = columnId === '_checkbox'

  /** Handle single click - select cell */
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!cellSelectionConfig?.enabled || isSystemColumn) return
      e.stopPropagation()
      setSelectedCell({ rowId, columnId })
    },
    [cellSelectionConfig?.enabled, isSystemColumn, rowId, columnId, setSelectedCell]
  )

  /** Handle double click - start editing */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!cellSelectionConfig?.enabled || isSystemColumn) return
      e.stopPropagation()
      setEditingCell({ rowId, columnId })
    },
    [cellSelectionConfig?.enabled, isSystemColumn, rowId, columnId, setEditingCell]
  )

  /** Handle keyboard navigation */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isSelected) return

      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          setEditingCell({ rowId, columnId })
          break
        case 'Escape':
          e.preventDefault()
          setSelectedCell(null)
          break
        // Arrow key navigation handled at higher level via useCellNavigation
      }
    },
    [isSelected, rowId, columnId, setEditingCell, setSelectedCell]
  )

  /** Close editor callback */
  const handleCloseEditor = useCallback(() => {
    setEditingCell(null)
    setSelectedCell({ rowId, columnId })
  }, [rowId, columnId, setEditingCell, setSelectedCell])

  return (
    <div
      ref={cellRef}
      data-col={columnId}
      className={cn(
        'group/cell flex items-center h-full relative outline-none',
        isSelected && 'cell-selected',
        isEditing && 'cell-editing',
        className
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isSelected ? 0 : -1}
      data-row-id={rowId}
      data-column-id={columnId}
      data-selected={isSelected}
      data-editing={isEditing}>
      {/* Selection overlay - hidden when child has data-self-overlay (e.g., ItemsCellView) */}
      {!isSystemColumn && (
        <CellSelectionOverlay
          isSelected={isSelected}
          isEditing={isEditing}
          className="group-has-[[data-self-overlay]]/cell:hidden"
        />
      )}

      {/* Cell content - rendered by the column's cell function */}
      {flexRender(cell.column.columnDef.cell, cell.getContext())}

      {/* Editor popover - only renders for the ONE cell being edited */}
      {isEditing && cellSelectionConfig && (
        <CellFieldEditor
          rowId={rowId}
          columnId={columnId}
          cellSelectionConfig={cellSelectionConfig}
          onClose={handleCloseEditor}
          anchorRef={cellRef}
        />
      )}
    </div>
  )
}

/** Memoized SelectableTableCell - prevents parent re-renders from cascading */
export const SelectableTableCell = memo(SelectableTableCellInner) as typeof SelectableTableCellInner

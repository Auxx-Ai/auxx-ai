// apps/web/src/components/dynamic-table/components/drag-drop-row.tsx

'use client'

import { useCallback, useMemo } from 'react'
import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { VirtualTableRow } from './virtual-table-row'
import { useTableContext } from '../context/table-context'
import type { DragDropConfig } from '../types'
import type { Row } from '@tanstack/react-table'
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual'

interface DragDropRowProps<TData> {
  row: Row<TData>
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
  onRowClick?: (row: TData, event: React.MouseEvent, rowId: string) => void
  rowClassName?: (row: TData) => string | undefined
  isLastClicked?: boolean
  /** Pre-computed selection state to avoid context re-renders */
  isSelected?: boolean
  /** Whether bulk mode is active - passed as prop to avoid context re-renders */
  isBulkMode?: boolean
  /** Whether checkboxes are enabled - passed as prop to avoid context re-renders */
  enableCheckbox?: boolean
  /** Toggle row selection handler - passed as prop to avoid context re-renders */
  toggleRowSelection?: (rowId: string, event: React.MouseEvent) => void
  dragDropConfig: DragDropConfig<TData>
  /** Whether cell selection is enabled - passed to VirtualTableRow */
  cellSelectionEnabled?: boolean
  /** Version that changes when column layout changes - busts memoization */
  columnLayoutVersion?: number
}

/**
 * Enhanced table row with drag and drop functionality
 */
export function DragDropRow<TData>({
  row,
  virtualRow,
  rowVirtualizer,
  onRowClick,
  rowClassName,
  isLastClicked = false,
  isSelected = false,
  isBulkMode = false,
  enableCheckbox = false,
  toggleRowSelection,
  dragDropConfig,
  cellSelectionEnabled = false,
  columnLayoutVersion,
}: DragDropRowProps<TData>) {
  const { activeDragItems } = useTableContext<TData>()

  // check if this row can be dragged.
  const canDragThis = dragDropConfig.canDrag?.(row.original) ?? true

  const isCurrentlyDragging = activeDragItems?.some((item) => item.id === row.id) ?? false

  // Check if this row can accept the current drag
  const canAcceptDrop = useMemo(() => {
    if (!dragDropConfig.enabled || !dragDropConfig.canDrop || !activeDragItems?.length) {
      return false
    }

    const canDrop = dragDropConfig.canDrop(activeDragItems, row.original)

    return canDrop
  }, [dragDropConfig, activeDragItems, row.original])

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    transition,
    isDragging,
  } = useDraggable({
    id: `row-${row.id}`,
    data: {
      type: 'table-row',
      items: [],
      sourceRow: row.original,
    },
    // disable dragging if dragging is not enabled or this row cant be dragged.
    disabled: !canDragThis || !dragDropConfig.enabled,
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${row.id}`,
    data: {
      type: 'table-row-drop',
      targetRow: row.original,
      accepts: ['table-row'],
    },
    disabled: !dragDropConfig.enabled || !canAcceptDrop,
  })

  // Combine refs
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  let dragStyle = transform
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : 'auto',
      }
    : {}

  // Enhanced row click handler that doesn't interfere with dragging
  const handleRowClick = useCallback(
    (row: TData, event: React.MouseEvent, rowId: string) => {
      // Don't trigger click if we're in the middle of a drag
      if (isDragging) return

      onRowClick?.(row, event, rowId)
    },
    [isDragging, onRowClick, row]
  )

  return (
    <VirtualTableRow
      row={row}
      ref={combinedRef}
      virtualRow={virtualRow}
      rowVirtualizer={rowVirtualizer}
      onRowClick={handleRowClick}
      rowClassName={rowClassName}
      isLastClicked={isLastClicked}
      isSelected={isSelected}
      isBulkMode={isBulkMode}
      enableCheckbox={enableCheckbox}
      toggleRowSelection={toggleRowSelection}
      // Pass drag attributes to enable dragging from anywhere on the row
      dragAttributes={canDragThis ? { ...attributes, ...listeners } : undefined}
      isDragging={isCurrentlyDragging}
      isDropTarget={canAcceptDrop}
      isOver={isOver}
      cellSelectionEnabled={cellSelectionEnabled}
      columnLayoutVersion={columnLayoutVersion}
    />
  )
}

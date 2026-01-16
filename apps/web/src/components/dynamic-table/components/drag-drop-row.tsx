// apps/web/src/components/dynamic-table/components/drag-drop-row.tsx

'use client'

import { useCallback, useMemo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { VirtualTableRow } from './virtual-table-row'
import { useViewMetadata } from '../context/view-metadata-context'
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
  isSelected?: boolean
  getIsBulkMode?: () => boolean
  enableCheckbox?: boolean
  toggleRowSelection?: (rowId: string, event: React.MouseEvent) => void
  dragDropConfig: DragDropConfig<TData>
  cellSelectionEnabled?: boolean
  columnSignature?: string
}

/**
 * Enhanced table row with drag and drop functionality
 *
 * Migrated to use split contexts instead of monolithic TableContext
 */
export function DragDropRow<TData>({
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
  dragDropConfig,
  cellSelectionEnabled = false,
  columnSignature,
}: DragDropRowProps<TData>) {
  const { activeDragItems } = useViewMetadata<TData>()

  const canDragThis = dragDropConfig.canDrag?.(row.original) ?? true
  const isCurrentlyDragging = activeDragItems?.some((item: any) => item.id === row.id) ?? false

  const canAcceptDrop = useMemo(() => {
    if (!dragDropConfig.enabled || !dragDropConfig.canDrop || !activeDragItems?.length) {
      return false
    }
    return dragDropConfig.canDrop(activeDragItems, row.original)
  }, [dragDropConfig, activeDragItems, row.original])

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `row-${row.id}`,
    data: {
      type: 'table-row',
      items: [],
      sourceRow: row.original,
    },
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

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  const handleRowClick = useCallback(
    (rowData: TData, event: React.MouseEvent, rowId: string) => {
      if (isDragging) return
      onRowClick?.(rowData, event, rowId)
    },
    [isDragging, onRowClick]
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
      getIsBulkMode={getIsBulkMode}
      enableCheckbox={enableCheckbox}
      toggleRowSelection={toggleRowSelection}
      dragAttributes={canDragThis ? { ...attributes, ...listeners } : undefined}
      isDragging={isCurrentlyDragging}
      isDropTarget={canAcceptDrop}
      isOver={isOver}
      cellSelectionEnabled={cellSelectionEnabled}
      columnSignature={columnSignature}
    />
  )
}

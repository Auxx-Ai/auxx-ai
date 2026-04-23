// apps/web/src/components/dynamic-table/components/selectable-table-cell.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type Cell, flexRender } from '@tanstack/react-table'
import { memo, useCallback, useMemo, useRef } from 'react'
import { CellActiveProvider } from '../context/cell-active-context'
import { useCellIndexerContext } from '../context/cell-indexer-context'
import {
  useCellSelectionConfig,
  useIsActiveCell,
  useIsEditingCell,
  useIsInRange,
  useRangeActions,
} from '../context/cell-selection-context'
import { useRangeDragContext } from '../context/range-drag-context'
import type { RangeEndpoint } from '../types'
import { getEditModeForFieldType } from '../utils/edit-mode'
import { sanitizeColumnId } from '../utils/sanitize-column-id'
import { CellFieldEditor } from './cell-field-editor'
import { InlineCellEditor } from './inline-cell-editor'

interface SelectableTableCellProps<TData> {
  cell: Cell<TData, unknown>
  rowId: string
  /** Column ID for CSS variable width - uses data-col attribute */
  columnId: string
  className?: string
}

function SelectableTableCellInner<TData>({
  cell,
  rowId,
  columnId,
  className,
}: SelectableTableCellProps<TData>) {
  const cellSelectionConfig = useCellSelectionConfig()
  const indexer = useCellIndexerContext()
  const drag = useRangeDragContext()

  const isActive = useIsActiveCell(rowId, columnId)
  const isInRange = useIsInRange(rowId, columnId)
  const isEditing = useIsEditingCell(rowId, columnId)
  const { setActiveCell, setEditingCell, setRange } = useRangeActions()

  const cellRef = useRef<HTMLDivElement>(null)

  const isSystemColumn = columnId === '_checkbox'

  const field = cellSelectionConfig?.getFieldDefinition?.(columnId)
  const editMode = getEditModeForFieldType(field?.fieldType)
  const isInlineEditing = isEditing && editMode === 'inline'
  const isPopoverEditing = isEditing && editMode === 'popover'

  const isUpdatable = field?.capabilities.updatable !== false

  /** Resolve this cell's range endpoint from the indexer */
  const resolveEndpoint = useCallback((): RangeEndpoint | null => {
    if (!indexer) return null
    const rowIndex = indexer.rowIdToIndex.get(rowId)
    const colIndex = indexer.columnIdToIndex.get(columnId)
    if (rowIndex === undefined || colIndex === undefined) return null
    return { rowId, columnId, rowIndex, colIndex }
  }, [indexer, rowId, columnId])

  /**
   * Pointer down — start a range drag (or extend a range if shift is held).
   * Stops propagation so dnd-kit's row sensor doesn't pick this up as a row drag.
   * Also calls preventDefault so the browser doesn't begin a text selection on
   * top of our range drag (caret placement / double-click word select).
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!cellSelectionConfig?.enabled || isSystemColumn) return
      // Ignore non-primary buttons (right-click, middle, etc.)
      if (e.button !== 0) return
      // Ignore events that bubbled here from a React portal (e.g. an open
      // popover editor like CellFieldEditor). React events bubble through
      // the React tree even across portals — the DOM target lives outside
      // this cell, so preventDefault would block the input from focusing.
      if (!cellRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
      e.preventDefault()

      const endpoint = resolveEndpoint()
      if (!endpoint) {
        // Indexer not ready — fall back to id-only set; range math kicks in once remap fires.
        setActiveCell({ rowId, columnId })
        return
      }

      if (drag) {
        drag.beginDrag(endpoint, e.pointerId, e.clientX, e.clientY, { extend: e.shiftKey })
      } else if (e.shiftKey) {
        // Manual extend without drag hook: read current range and replace focus.
        // Falls through to setRange via the actions API.
        setRange({ anchor: endpoint, focus: endpoint })
      } else {
        setActiveCell({ rowId, columnId })
      }
    },
    [
      cellSelectionConfig?.enabled,
      isSystemColumn,
      resolveEndpoint,
      drag,
      setActiveCell,
      setRange,
      rowId,
      columnId,
    ]
  )

  /** Click is now a no-op for selection (pointerdown handles it) — kept only to swallow row clicks */
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!cellSelectionConfig?.enabled || isSystemColumn) return
      // Skip portal-bubbled events (see handlePointerDown).
      if (!cellRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
    },
    [cellSelectionConfig?.enabled, isSystemColumn]
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!cellSelectionConfig?.enabled || isSystemColumn || !isUpdatable) return
      if (!cellRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
      setEditingCell({ rowId, columnId })
    },
    [cellSelectionConfig?.enabled, isSystemColumn, isUpdatable, rowId, columnId, setEditingCell]
  )

  /** Keyboard navigation handled centrally in useCellNavigation; only handle local edit-shortcuts */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isActive) return
      if (isEditing && e.key === 'Escape') return
      // Skip portal-bubbled events (e.g. typing inside an open popover editor).
      if (!cellRef.current?.contains(e.target as Node)) return
      switch (e.key) {
        case 'Enter':
          if (!isUpdatable) return
          e.preventDefault()
          setEditingCell({ rowId, columnId })
          break
        case 'Escape':
          e.preventDefault()
          setActiveCell(null)
          break
      }
    },
    [isActive, isEditing, isUpdatable, rowId, columnId, setEditingCell, setActiveCell]
  )

  const handleCloseEditor = useCallback(() => {
    setEditingCell(null)
    setActiveCell({ rowId, columnId })
  }, [rowId, columnId, setEditingCell, setActiveCell])

  const cellActiveValue = useMemo(() => ({ isActive, isEditing }), [isActive, isEditing])

  return (
    <div
      ref={cellRef}
      data-col={sanitizeColumnId(columnId)}
      className={cn(
        'group/cell flex items-center h-full relative outline-none select-none',
        // .cell-active drives focus ring + content expansion (ExpandableCell, PrimaryCell).
        // .cell-selected kept as alias so existing CSS selectors keep matching the active cell.
        isActive && 'cell-active cell-selected',
        isInRange && 'cell-in-range',
        isEditing && 'cell-editing',
        !isUpdatable && 'read-only',
        className
      )}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isActive ? 0 : -1}
      data-row-id={rowId}
      data-column-id={columnId}
      data-selected={isActive}
      data-editing={isEditing}
      title={!isUpdatable ? 'This field is read-only' : undefined}>
      <CellActiveProvider value={cellActiveValue}>
        <div className={cn('contents', isInlineEditing && 'invisible')}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>

        {isInlineEditing && cellSelectionConfig && (
          <InlineCellEditor
            rowId={rowId}
            columnId={columnId}
            cellSelectionConfig={cellSelectionConfig}
            onClose={handleCloseEditor}
          />
        )}

        {isPopoverEditing && cellSelectionConfig && (
          <CellFieldEditor
            rowId={rowId}
            columnId={columnId}
            cellSelectionConfig={cellSelectionConfig}
            onClose={handleCloseEditor}
            anchorRef={cellRef}
          />
        )}
      </CellActiveProvider>
    </div>
  )
}

export const SelectableTableCell = memo(SelectableTableCellInner) as typeof SelectableTableCellInner

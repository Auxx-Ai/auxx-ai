// apps/web/src/components/dynamic-table/hooks/use-cell-navigation.ts
'use client'

import type { Table } from '@tanstack/react-table'
import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type { CellRange, CellSelectionState, RangeEndpoint } from '../types'
import { isSingleCell, singleRange } from '../utils/range'

interface UseCellNavigationOptions<TData> {
  table: Table<TData>
  tableId: string
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Keyboard navigation for the cell selection range.
 *
 * Single-cell mode (Arrow / Tab / Enter / Escape) preserves today's behavior.
 * Range mode (Shift+Arrow / Cmd+Shift+Arrow / Cmd+A) extends the focus while
 * keeping the anchor put.
 */
export function useCellNavigation<TData>({
  table,
  tableId,
  enabled,
  scrollContainerRef,
}: UseCellNavigationOptions<TData>) {
  /** Track last known position for resuming navigation after Escape clears */
  const lastPositionRef = useRef<CellSelectionState | null>(null)

  // Subscribe to range changes so lastPositionRef stays warm.
  const range = useSelectionStore((s) => s.tables[tableId]?.range ?? null)
  const editingCell = useSelectionStore((s) => s.tables[tableId]?.editingCell ?? null)

  useEffect(() => {
    if (range) {
      lastPositionRef.current = { rowId: range.focus.rowId, columnId: range.focus.columnId }
    }
  }, [range])

  const scrollCellIntoView = useCallback(
    (rowId: string, columnId: string, direction?: 'left' | 'right' | 'up' | 'down') => {
      const container = scrollContainerRef.current
      if (!container) return

      requestAnimationFrame(() => {
        const cell = container.querySelector(
          `[data-row-id="${rowId}"][data-column-id="${columnId}"]`
        ) as HTMLElement | null

        if (cell) {
          const inlinePosition = direction === 'left' ? 'start' : 'nearest'
          cell.scrollIntoView({ block: 'nearest', inline: inlinePosition, behavior: 'auto' })
        }
      })
    },
    [scrollContainerRef]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (editingCell || !enabled) return
      if (!scrollContainerRef.current?.contains(e.target as Node)) return

      const store = useSelectionStore.getState()
      const currentRange = store.getRange(tableId)

      const rows = table.getRowModel().rows
      const columns = table.getVisibleLeafColumns().filter((col) => col.id !== '_checkbox')
      const isMod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+A — select all visible cells
      if (isMod && e.key === 'a') {
        e.preventDefault()
        const firstRow = rows[0]
        const firstCol = columns[0]
        const lastRow = rows[rows.length - 1]
        const lastCol = columns[columns.length - 1]
        if (!firstRow || !firstCol || !lastRow || !lastCol) return
        const anchor: RangeEndpoint = {
          rowId: firstRow.id,
          columnId: firstCol.id,
          rowIndex: 0,
          colIndex: 0,
        }
        const focus: RangeEndpoint = {
          rowId: lastRow.id,
          columnId: lastCol.id,
          rowIndex: rows.length - 1,
          colIndex: columns.length - 1,
        }
        store.setRange(tableId, { anchor, focus })
        return
      }

      // Resolve current focus (use range, or fall back to last position)
      const focusAddr = currentRange
        ? { rowId: currentRange.focus.rowId, columnId: currentRange.focus.columnId }
        : lastPositionRef.current
      if (!focusAddr) return

      const currentRowIndex = rows.findIndex((r) => r.id === focusAddr.rowId)
      const currentColIndex = columns.findIndex((c) => c.id === focusAddr.columnId)
      if (currentRowIndex === -1 || currentColIndex === -1) {
        lastPositionRef.current = null
        return
      }

      let newRowIndex = currentRowIndex
      let newColIndex = currentColIndex
      let direction: 'left' | 'right' | 'up' | 'down' | undefined

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          newRowIndex = isMod ? 0 : Math.max(0, currentRowIndex - 1)
          direction = 'up'
          break
        case 'ArrowDown':
          e.preventDefault()
          newRowIndex = isMod ? rows.length - 1 : Math.min(rows.length - 1, currentRowIndex + 1)
          direction = 'down'
          break
        case 'ArrowLeft':
          e.preventDefault()
          newColIndex = isMod ? 0 : Math.max(0, currentColIndex - 1)
          direction = 'left'
          break
        case 'ArrowRight':
          e.preventDefault()
          newColIndex = isMod
            ? columns.length - 1
            : Math.min(columns.length - 1, currentColIndex + 1)
          direction = 'right'
          break
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) {
            if (currentColIndex > 0) {
              newColIndex = currentColIndex - 1
              direction = 'left'
            } else if (currentRowIndex > 0) {
              newRowIndex = currentRowIndex - 1
              newColIndex = columns.length - 1
              direction = 'left'
            }
          } else {
            if (currentColIndex < columns.length - 1) {
              newColIndex = currentColIndex + 1
              direction = 'right'
            } else if (currentRowIndex < rows.length - 1) {
              newRowIndex = currentRowIndex + 1
              newColIndex = 0
              direction = 'right'
            }
          }
          break
        case 'Enter':
          if (!currentRange) return
          e.preventDefault()
          store.setEditingCell(tableId, focusAddr)
          return
        case 'Escape':
          if (!currentRange) return
          e.preventDefault()
          // First Escape collapses range to anchor; second clears.
          if (currentRange && !isSingleCell(currentRange)) {
            store.setRange(tableId, singleRange(currentRange.anchor))
          } else {
            store.setRange(tableId, null)
          }
          return
        default:
          return
      }

      const newRow = rows[newRowIndex]
      const newCol = columns[newColIndex]
      if (!newRow || !newCol) return

      const newFocus: RangeEndpoint = {
        rowId: newRow.id,
        columnId: newCol.id,
        rowIndex: newRowIndex,
        colIndex: newColIndex,
      }

      // Tab always collapses to single cell. Shift+Arrow extends; plain Arrow collapses.
      const shouldExtend = e.shiftKey && e.key !== 'Tab'
      if (shouldExtend && currentRange) {
        const next: CellRange = { anchor: currentRange.anchor, focus: newFocus }
        store.setRange(tableId, next)
      } else {
        store.setRange(tableId, { anchor: newFocus, focus: newFocus })
      }
      scrollCellIntoView(newRow.id, newCol.id, direction)
    },
    [table, tableId, editingCell, enabled, scrollCellIntoView, scrollContainerRef]
  )

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, enabled])
}

// apps/web/src/components/dynamic-table/hooks/use-cell-navigation.ts
'use client'

import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { Table } from '@tanstack/react-table'
import type { CellSelectionState } from '../types'

interface UseCellNavigationOptions<TData> {
  table: Table<TData>
  selectedCell: CellSelectionState | null
  setSelectedCell: (cell: CellSelectionState | null) => void
  editingCell: CellSelectionState | null
  setEditingCell: (cell: CellSelectionState | null) => void
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Hook for keyboard navigation between cells
 * - Arrow keys: move selection between cells
 * - Tab/Shift+Tab: move selection right/left, wrapping to next/previous row
 * - Enter: start editing selected cell
 * - Escape: deselect cell
 */
export function useCellNavigation<TData>({
  table,
  selectedCell,
  setSelectedCell,
  editingCell,
  setEditingCell,
  enabled,
  scrollContainerRef,
}: UseCellNavigationOptions<TData>) {
  /** Track last known position for resuming navigation after Escape deselect */
  const lastPositionRef = useRef<CellSelectionState | null>(null)

  /** Update last position when selection changes to a non-null value */
  useEffect(() => {
    if (selectedCell) {
      lastPositionRef.current = selectedCell
    }
  }, [selectedCell])

  /** Scroll cell into view after keyboard navigation */
  const scrollCellIntoView = useCallback(
    (rowId: string, columnId: string, direction?: 'left' | 'right' | 'up' | 'down') => {
      const container = scrollContainerRef.current
      if (!container) return

      // Use requestAnimationFrame to ensure DOM is updated after state change
      requestAnimationFrame(() => {
        const cell = container.querySelector(
          `[data-row-id="${rowId}"][data-column-id="${columnId}"]`
        ) as HTMLElement | null

        if (cell) {
          // Use 'start' for left navigation to force scroll past pinned columns
          // 'nearest' doesn't scroll if cell is partially visible (behind pinned area)
          const inlinePosition = direction === 'left' ? 'start' : 'nearest'

          cell.scrollIntoView({
            block: 'nearest',
            inline: inlinePosition,
            behavior: 'auto',
          })
        }
      })
    },
    [scrollContainerRef]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't navigate while editing
      if (editingCell || !enabled) return

      // Use current selection, or fall back to last position for resuming after Escape
      const activeCell = selectedCell || lastPositionRef.current
      if (!activeCell) return

      const rows = table.getRowModel().rows
      const columns = table.getVisibleLeafColumns().filter((col) => col.id !== '_checkbox')

      const currentRowIndex = rows.findIndex((r) => r.id === activeCell.rowId)
      const currentColIndex = columns.findIndex((c) => c.id === activeCell.columnId)

      // If position no longer valid (row deleted, etc.), reset and do nothing
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
          newRowIndex = Math.max(0, currentRowIndex - 1)
          direction = 'up'
          break
        case 'ArrowDown':
          e.preventDefault()
          newRowIndex = Math.min(rows.length - 1, currentRowIndex + 1)
          direction = 'down'
          break
        case 'ArrowLeft':
          e.preventDefault()
          newColIndex = Math.max(0, currentColIndex - 1)
          direction = 'left'
          break
        case 'ArrowRight':
          e.preventDefault()
          newColIndex = Math.min(columns.length - 1, currentColIndex + 1)
          direction = 'right'
          break
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) {
            // Move left, or to end of previous row
            if (currentColIndex > 0) {
              newColIndex = currentColIndex - 1
              direction = 'left'
            } else if (currentRowIndex > 0) {
              newRowIndex = currentRowIndex - 1
              newColIndex = columns.length - 1
              direction = 'left'
            }
          } else {
            // Move right, or to start of next row
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
          // Only enter edit mode if there's an actual selection (not just lastPosition)
          if (!selectedCell) return
          e.preventDefault()
          setEditingCell(selectedCell)
          return
        case 'Escape':
          // Only deselect if there's an actual selection
          if (!selectedCell) return
          e.preventDefault()
          setSelectedCell(null)
          return
        default:
          return
      }

      const newRow = rows[newRowIndex]
      const newCol = columns[newColIndex]

      if (newRow && newCol) {
        setSelectedCell({ rowId: newRow.id, columnId: newCol.id })
        scrollCellIntoView(newRow.id, newCol.id, direction)
      }
    },
    [table, selectedCell, editingCell, enabled, setSelectedCell, setEditingCell, scrollCellIntoView]
  )

  useEffect(() => {
    if (!enabled) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, enabled])
}

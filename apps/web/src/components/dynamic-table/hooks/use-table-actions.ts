// apps/web/src/components/dynamic-table/hooks/use-table-actions.ts

import type { RowSelectionState } from '@tanstack/react-table'
import { useCallback } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type { CellSelectionState } from '../types'

// ============================================================================
// ROW SELECTION ACTIONS
// ============================================================================

/** Get action to set row selection */
export function useSetRowSelection(tableId: string) {
  return useCallback(
    (selectionOrUpdater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
      const store = useSelectionStore.getState()

      // Get current value
      const current = store.getRowSelection(tableId)

      // Resolve updater function if needed
      const selection =
        typeof selectionOrUpdater === 'function' ? selectionOrUpdater(current) : selectionOrUpdater

      store.setRowSelection(tableId, selection)
    },
    [tableId]
  )
}

/** Get action to toggle row selection with shift-select support */
export function useToggleRowSelection(tableId: string) {
  return useCallback(
    (
      rowId: string,
      event: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
      allRowIds?: string[]
    ) => {
      useSelectionStore.getState().toggleRow(tableId, rowId, event, allRowIds)
    },
    [tableId]
  )
}

/** Get action to reset row selection */
export function useResetRowSelection(tableId: string) {
  return useCallback(() => {
    useSelectionStore.getState().resetRowSelection(tableId)
  }, [tableId])
}

// ============================================================================
// CELL SELECTION ACTIONS
// ============================================================================

/** Get action to set selected cell */
export function useSetSelectedCell(tableId: string) {
  return useCallback(
    (cell: CellSelectionState | null) => {
      useSelectionStore.getState().setSelectedCell(tableId, cell)
    },
    [tableId]
  )
}

/** Get action to set editing cell */
export function useSetEditingCell(tableId: string) {
  return useCallback(
    (cell: CellSelectionState | null) => {
      useSelectionStore.getState().setEditingCell(tableId, cell)
    },
    [tableId]
  )
}

// ============================================================================
// KANBAN SELECTION ACTIONS
// ============================================================================

/** Get action to set kanban selection */
export function useSetKanbanSelection(tableId: string) {
  return useCallback(
    (ids: Set<string>) => {
      useSelectionStore.getState().setKanbanSelection(tableId, ids)
    },
    [tableId]
  )
}

/** Get action to reset kanban selection */
export function useResetKanbanSelection(tableId: string) {
  return useCallback(() => {
    useSelectionStore.getState().resetKanbanSelection(tableId)
  }, [tableId])
}

// ============================================================================
// DRAG & DROP ACTIONS
// ============================================================================

/** Get action to set active drag items */
export function useSetActiveDragItems(tableId: string) {
  return useCallback(
    (items: any[] | null) => {
      useSelectionStore.getState().setActiveDragItems(tableId, items)
    },
    [tableId]
  )
}

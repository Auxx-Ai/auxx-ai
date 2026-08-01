// apps/web/src/components/dynamic-table/hooks/use-table-selectors.ts

import type { RowSelectionState } from '@tanstack/react-table'
import { useShallow } from 'zustand/react/shallow'
import { useSelectionStore } from '../stores/selection-store'
import type { CellSelectionState } from '../types'
import { isSingleCell } from '../utils/range'

// ============================================================================
// STABLE REFERENCES (prevent unnecessary re-renders)
// ============================================================================

const EMPTY_ROW_SELECTION: RowSelectionState = {}
const EMPTY_KANBAN_CARD_IDS: Set<string> = new Set()

// ============================================================================
// ROW SELECTION SELECTORS
// ============================================================================

/** Get row selection for table */
export function useRowSelection(tableId: string): RowSelectionState {
  return useSelectionStore(
    useShallow((state) => state.tables[tableId]?.rowSelection ?? EMPTY_ROW_SELECTION)
  )
}

/** Get last clicked row ID */
export function useLastClickedRowId(tableId: string): string | null {
  return useSelectionStore((state) => state.tables[tableId]?.lastClickedRowId ?? null)
}

/** Get last selected index */
export function useLastSelectedIndex(tableId: string): number | null {
  return useSelectionStore((state) => state.tables[tableId]?.lastSelectedIndex ?? null)
}

// ============================================================================
// CELL SELECTION SELECTORS
// ============================================================================

/**
 * Get the selected cell for a table.
 * `range` is the source of truth; this is the 1×1 shim, mirroring the store's
 * own `getSelectedCell`.
 */
export function useSelectedCell(tableId: string): CellSelectionState | null {
  return useSelectionStore(
    useShallow((state) => {
      const range = state.tables[tableId]?.range
      if (!range || !isSingleCell(range)) return null
      return { rowId: range.focus.rowId, columnId: range.focus.columnId }
    })
  )
}

/** Get editing cell for table */
export function useEditingCell(tableId: string): CellSelectionState | null {
  return useSelectionStore((state) => state.tables[tableId]?.editingCell ?? null)
}

// ============================================================================
// KANBAN SELECTION SELECTORS
// ============================================================================

/** Get kanban selection for table */
export function useKanbanSelection(tableId: string): Set<string> {
  return useSelectionStore(
    (state) => state.tables[tableId]?.selectedKanbanCardIds ?? EMPTY_KANBAN_CARD_IDS
  )
}

// ============================================================================
// DRAG & DROP SELECTORS
// ============================================================================

/** Get active drag items for table */
export function useActiveDragItems(tableId: string): any[] | null {
  return useSelectionStore((state) => state.tables[tableId]?.activeDragItems ?? null)
}

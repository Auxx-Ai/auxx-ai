// apps/web/src/components/dynamic-table/stores/selection-store.ts
'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { produce } from 'immer'
import type { RowSelectionState } from '@tanstack/react-table'
import type { CellSelectionState } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/** Stable empty constants to prevent unnecessary re-renders */
const EMPTY_ROW_SELECTION: RowSelectionState = {}
const EMPTY_KANBAN_SELECTION: Set<string> = new Set()

/** Selection state for a single table */
interface TableSelectionState {
  // Row selection
  rowSelection: RowSelectionState
  lastSelectedIndex: number | null
  lastClickedRowId: string | null

  // Cell selection
  selectedCell: CellSelectionState | null
  editingCell: CellSelectionState | null

  // Kanban selection
  selectedKanbanCardIds: Set<string>

  // Drag & drop
  activeDragItems: any[] | null
}

/** Default selection state */
const DEFAULT_SELECTION_STATE: TableSelectionState = {
  rowSelection: EMPTY_ROW_SELECTION,
  lastSelectedIndex: null,
  lastClickedRowId: null,
  selectedCell: null,
  editingCell: null,
  selectedKanbanCardIds: EMPTY_KANBAN_SELECTION,
  activeDragItems: null,
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface SelectionStore {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Selection state keyed by tableId */
  tables: Record<string, TableSelectionState>

  // ═══════════════════════════════════════════════════════════════════════════
  // ROW SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set row selection for a table */
  setRowSelection: (tableId: string, selection: RowSelectionState) => void

  /** Toggle a single row (with shift-select support) */
  toggleRow: (
    tableId: string,
    rowId: string,
    event: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
    allRowIds?: string[]
  ) => void

  /** Reset row selection for a table */
  resetRowSelection: (tableId: string) => void

  /** Get row selection for a table */
  getRowSelection: (tableId: string) => RowSelectionState

  /** Set last clicked row ID */
  setLastClickedRowId: (tableId: string, rowId: string | null) => void

  /** Set last selected index */
  setLastSelectedIndex: (tableId: string, index: number | null) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set selected cell for a table */
  setSelectedCell: (tableId: string, cell: CellSelectionState | null) => void

  /** Set editing cell for a table */
  setEditingCell: (tableId: string, cell: CellSelectionState | null) => void

  /** Get selected cell for a table */
  getSelectedCell: (tableId: string) => CellSelectionState | null

  /** Get editing cell for a table */
  getEditingCell: (tableId: string) => CellSelectionState | null

  // ═══════════════════════════════════════════════════════════════════════════
  // KANBAN SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set kanban selection for a table */
  setKanbanSelection: (tableId: string, ids: Set<string>) => void

  /** Get kanban selection for a table */
  getKanbanSelection: (tableId: string) => Set<string>

  /** Reset kanban selection for a table */
  resetKanbanSelection: (tableId: string) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG & DROP ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set active drag items for a table */
  setActiveDragItems: (tableId: string, items: any[] | null) => void

  /** Get active drag items for a table */
  getActiveDragItems: (tableId: string) => any[] | null

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /** Clear selection state for a table */
  clearTable: (tableId: string) => void

  /** Clear all state (on logout/org switch) */
  clearAll: () => void
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useSelectionStore = create<SelectionStore>()(
  subscribeWithSelector((set, get) => ({
    // ─── INITIAL STATE ─────────────────────────────────────────────────────────
    tables: {},

    // ─── ROW SELECTION ACTIONS ─────────────────────────────────────────────────
    setRowSelection: (tableId, selection) => {
      console.log('[SelectionStore] setRowSelection called:', { tableId, selection })
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].rowSelection = selection
        })
      )
    },

    toggleRow: (tableId, rowId, event, allRowIds = []) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }

          const tableState = draft.tables[tableId]
          const { rowSelection, lastClickedRowId, lastSelectedIndex } = tableState

          let newSelection = { ...rowSelection }
          let newLastIndex = lastSelectedIndex
          let newLastClickedRowId = rowId

          // Shift+Click: Range selection
          if (event.shiftKey && lastClickedRowId && allRowIds.length > 0) {
            const lastIndex = allRowIds.indexOf(lastClickedRowId)
            const currentIndex = allRowIds.indexOf(rowId)

            if (lastIndex !== -1 && currentIndex !== -1) {
              const start = Math.min(lastIndex, currentIndex)
              const end = Math.max(lastIndex, currentIndex)

              for (let i = start; i <= end; i++) {
                newSelection[allRowIds[i]] = true
              }
              newLastIndex = currentIndex
            }
          }
          // Cmd/Ctrl+Click: Toggle selection
          else if (event.metaKey || event.ctrlKey) {
            newSelection = {
              ...rowSelection,
              [rowId]: !rowSelection[rowId],
            }
            newLastIndex = allRowIds.indexOf(rowId)
          }
          // Regular click: Single selection
          else {
            newSelection = { [rowId]: true }
            newLastIndex = allRowIds.indexOf(rowId)
          }

          tableState.rowSelection = newSelection
          tableState.lastClickedRowId = newLastClickedRowId
          tableState.lastSelectedIndex = newLastIndex
        })
      )
    },

    resetRowSelection: (tableId) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].rowSelection = EMPTY_ROW_SELECTION
          draft.tables[tableId].lastClickedRowId = null
          draft.tables[tableId].lastSelectedIndex = null
        })
      )
    },

    getRowSelection: (tableId) => {
      return get().tables[tableId]?.rowSelection ?? EMPTY_ROW_SELECTION
    },

    setLastClickedRowId: (tableId, rowId) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].lastClickedRowId = rowId
        })
      )
    },

    setLastSelectedIndex: (tableId, index) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].lastSelectedIndex = index
        })
      )
    },

    // ─── CELL SELECTION ACTIONS ────────────────────────────────────────────────
    setSelectedCell: (tableId, cell) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].selectedCell = cell
        })
      )
    },

    setEditingCell: (tableId, cell) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].editingCell = cell
        })
      )
    },

    getSelectedCell: (tableId) => {
      return get().tables[tableId]?.selectedCell ?? null
    },

    getEditingCell: (tableId) => {
      return get().tables[tableId]?.editingCell ?? null
    },

    // ─── KANBAN SELECTION ACTIONS ──────────────────────────────────────────────
    setKanbanSelection: (tableId, ids) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].selectedKanbanCardIds = ids
        })
      )
    },

    getKanbanSelection: (tableId) => {
      return get().tables[tableId]?.selectedKanbanCardIds ?? EMPTY_KANBAN_SELECTION
    },

    resetKanbanSelection: (tableId) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].selectedKanbanCardIds = EMPTY_KANBAN_SELECTION
        })
      )
    },

    // ─── DRAG & DROP ACTIONS ───────────────────────────────────────────────────
    setActiveDragItems: (tableId, items) => {
      set((state) =>
        produce(state, (draft) => {
          if (!draft.tables[tableId]) {
            draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
          }
          draft.tables[tableId].activeDragItems = items
        })
      )
    },

    getActiveDragItems: (tableId) => {
      return get().tables[tableId]?.activeDragItems ?? null
    },

    // ─── CLEANUP ───────────────────────────────────────────────────────────────
    clearTable: (tableId) => {
      set((state) => {
        const { [tableId]: _, ...rest } = state.tables
        return { tables: rest }
      })
    },

    clearAll: () => {
      set({ tables: {} })
    },
  }))
)

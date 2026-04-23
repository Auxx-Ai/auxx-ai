// apps/web/src/components/dynamic-table/stores/selection-store.ts
'use client'

import type { RowSelectionState } from '@tanstack/react-table'
import { produce } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { CellAddress, CellRange, CellSelectionState, RangeEndpoint } from '../types'
import { isSingleCell, singleRange } from '../utils/range'

// ============================================================================
// TYPES
// ============================================================================

/** Stable empty constants to prevent unnecessary re-renders */
const EMPTY_ROW_SELECTION: RowSelectionState = {}
const EMPTY_KANBAN_SELECTION: Set<string> = new Set()

/** Live state during an Excel-style fill-handle drag */
export interface FillDragState {
  /** Snapshot of the active range at drag start — the source the fill tiles from. */
  source: CellRange
  /** The filled rectangle as currently previewed (includes source cells). */
  preview: CellRange
  /** Axis locked at drag start once the pointer has moved ≥4px. */
  axis: 'vertical' | 'horizontal'
}

/** Selection state for a single table */
interface TableSelectionState {
  // Row selection
  rowSelection: RowSelectionState
  lastSelectedIndex: number | null
  lastClickedRowId: string | null

  // Cell selection — `range` is the source of truth.
  // `selectedCell` survives as a 1×1 shim for legacy consumers.
  range: CellRange | null
  editingCell: CellSelectionState | null

  // Fill-handle drag preview (null when not dragging)
  fillDrag: FillDragState | null

  // Marching-ants highlight around the most recently copied range. Cleared on
  // paste, on Escape, on next copy. Independent of the active selection so the
  // user can move the cursor without losing the paste-source indicator.
  copyHighlight: CellRange | null

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
  range: null,
  editingCell: null,
  fillDrag: null,
  copyHighlight: null,
  selectedKanbanCardIds: EMPTY_KANBAN_SELECTION,
  activeDragItems: null,
}

/** Read-only id snapshot used for endpoint remapping */
export interface VisibleIdMaps {
  rowIdToIndex: Map<string, number>
  columnIdToIndex: Map<string, number>
  rowIds: string[]
  columnIds: string[]
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface SelectionStore {
  /** Selection state keyed by tableId */
  tables: Record<string, TableSelectionState>

  // ── ROW SELECTION ────────────────────────────────────────────────────────
  setRowSelection: (tableId: string, selection: RowSelectionState) => void
  toggleRow: (
    tableId: string,
    rowId: string,
    event: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
    allRowIds?: string[]
  ) => void
  resetRowSelection: (tableId: string) => void
  getRowSelection: (tableId: string) => RowSelectionState
  setLastClickedRowId: (tableId: string, rowId: string | null) => void
  setLastSelectedIndex: (tableId: string, index: number | null) => void

  // ── CELL SELECTION (range) ───────────────────────────────────────────────
  /** Replace the entire range. Pass null to clear. */
  setRange: (tableId: string, range: CellRange | null) => void
  /** Update only the focus endpoint (drag/keyboard extension). No-op when no range. */
  setRangeFocus: (tableId: string, focus: RangeEndpoint) => void
  /** Read range */
  getRange: (tableId: string) => CellRange | null

  /** Backward-compat shim: set a 1×1 range from a CellAddress (indexes unknown — remap fills them in) */
  setSelectedCell: (tableId: string, cell: CellSelectionState | null) => void
  /** Backward-compat shim: returns range.focus when 1×1, else null */
  getSelectedCell: (tableId: string) => CellSelectionState | null

  setEditingCell: (tableId: string, cell: CellSelectionState | null) => void
  getEditingCell: (tableId: string) => CellSelectionState | null

  /** Fill-handle drag: live preview state. null when not dragging. */
  setFillDrag: (tableId: string, drag: FillDragState | null) => void
  getFillDrag: (tableId: string) => FillDragState | null

  /** Copy highlight (marching ants) — set on copy, cleared on paste/Escape. */
  setCopyHighlight: (tableId: string, range: CellRange | null) => void

  /**
   * Re-derive range endpoint indexes from current visible ids.
   * Clips to remaining ids if one endpoint disappears; clears if both gone.
   * Called by useCellIndexer when the visible-id signature changes.
   */
  remapRange: (tableId: string, maps: VisibleIdMaps) => void

  // ── KANBAN SELECTION ─────────────────────────────────────────────────────
  setKanbanSelection: (tableId: string, ids: Set<string>) => void
  getKanbanSelection: (tableId: string) => Set<string>
  resetKanbanSelection: (tableId: string) => void

  // ── DRAG & DROP ──────────────────────────────────────────────────────────
  setActiveDragItems: (tableId: string, items: any[] | null) => void
  getActiveDragItems: (tableId: string) => any[] | null

  // ── CLEANUP ──────────────────────────────────────────────────────────────
  clearTable: (tableId: string) => void
  clearAll: () => void
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

function ensureTable(draft: { tables: Record<string, TableSelectionState> }, tableId: string) {
  if (!draft.tables[tableId]) {
    draft.tables[tableId] = { ...DEFAULT_SELECTION_STATE }
  }
  return draft.tables[tableId]
}

export const useSelectionStore = create<SelectionStore>()(
  subscribeWithSelector((set, get) => ({
    tables: {},

    // ─── ROW SELECTION ─────────────────────────────────────────────────────
    setRowSelection: (tableId, selection) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).rowSelection = selection
        })
      )
    },

    toggleRow: (tableId, rowId, event, allRowIds = []) => {
      set((state) =>
        produce(state, (draft) => {
          const tableState = ensureTable(draft, tableId)
          const { rowSelection, lastClickedRowId, lastSelectedIndex } = tableState

          let newSelection = { ...rowSelection }
          let newLastIndex = lastSelectedIndex
          const newLastClickedRowId = rowId

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
          } else if (event.metaKey || event.ctrlKey) {
            newSelection = { ...rowSelection, [rowId]: !rowSelection[rowId] }
            newLastIndex = allRowIds.indexOf(rowId)
          } else {
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
          const t = ensureTable(draft, tableId)
          t.rowSelection = EMPTY_ROW_SELECTION
          t.lastClickedRowId = null
          t.lastSelectedIndex = null
        })
      )
    },

    getRowSelection: (tableId) => get().tables[tableId]?.rowSelection ?? EMPTY_ROW_SELECTION,

    setLastClickedRowId: (tableId, rowId) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).lastClickedRowId = rowId
        })
      )
    },

    setLastSelectedIndex: (tableId, index) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).lastSelectedIndex = index
        })
      )
    },

    // ─── CELL SELECTION (range) ────────────────────────────────────────────
    setRange: (tableId, range) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).range = range
        })
      )
    },

    setRangeFocus: (tableId, focus) => {
      set((state) =>
        produce(state, (draft) => {
          const t = ensureTable(draft, tableId)
          if (!t.range) return
          // Cheap dedupe: skip when nothing changed
          if (
            t.range.focus.rowId === focus.rowId &&
            t.range.focus.columnId === focus.columnId &&
            t.range.focus.rowIndex === focus.rowIndex &&
            t.range.focus.colIndex === focus.colIndex
          ) {
            return
          }
          t.range.focus = focus
        })
      )
    },

    getRange: (tableId) => get().tables[tableId]?.range ?? null,

    setSelectedCell: (tableId, cell) => {
      set((state) =>
        produce(state, (draft) => {
          const t = ensureTable(draft, tableId)
          if (!cell) {
            t.range = null
            return
          }
          // Indexes unknown at this point — remap fills them in on next signature change.
          const ep: RangeEndpoint = { ...cell, rowIndex: -1, colIndex: -1 }
          t.range = singleRange(ep)
        })
      )
    },

    getSelectedCell: (tableId) => {
      const range = get().tables[tableId]?.range
      if (!range || !isSingleCell(range)) return null
      return { rowId: range.focus.rowId, columnId: range.focus.columnId }
    },

    setEditingCell: (tableId, cell) => {
      set((state) =>
        produce(state, (draft) => {
          const t = ensureTable(draft, tableId)
          t.editingCell = cell
          // Starting edit collapses the range to a 1×1 at the editing cell.
          // Edit targets the anchor (the active cell under Excel-style semantics),
          // so prefer the anchor's indexes when reusing a known endpoint.
          if (cell) {
            const existing = t.range
            const ep: RangeEndpoint =
              existing &&
              existing.anchor.rowId === cell.rowId &&
              existing.anchor.columnId === cell.columnId
                ? existing.anchor
                : {
                    ...cell,
                    rowIndex: existing?.anchor.rowIndex ?? -1,
                    colIndex: existing?.anchor.colIndex ?? -1,
                  }
            t.range = singleRange(ep)
          }
        })
      )
    },

    getEditingCell: (tableId) => get().tables[tableId]?.editingCell ?? null,

    setFillDrag: (tableId, drag) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).fillDrag = drag
        })
      )
    },

    getFillDrag: (tableId) => get().tables[tableId]?.fillDrag ?? null,

    setCopyHighlight: (tableId, range) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).copyHighlight = range
        })
      )
    },

    remapRange: (tableId, maps) => {
      set((state) =>
        produce(state, (draft) => {
          const t = draft.tables[tableId]
          if (!t || !t.range) return

          const remap = (ep: RangeEndpoint): RangeEndpoint | null => {
            const r = maps.rowIdToIndex.get(ep.rowId)
            const c = maps.columnIdToIndex.get(ep.columnId)
            if (r === undefined || c === undefined) return null
            return { rowId: ep.rowId, columnId: ep.columnId, rowIndex: r, colIndex: c }
          }

          const a = remap(t.range.anchor)
          const f = remap(t.range.focus)

          if (!a && !f) {
            t.range = null
            return
          }
          // If only one endpoint survives, clip both to it.
          const survivor = a ?? f
          t.range = { anchor: a ?? survivor!, focus: f ?? survivor! }
        })
      )
    },

    // ─── KANBAN ────────────────────────────────────────────────────────────
    setKanbanSelection: (tableId, ids) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).selectedKanbanCardIds = ids
        })
      )
    },

    getKanbanSelection: (tableId) =>
      get().tables[tableId]?.selectedKanbanCardIds ?? EMPTY_KANBAN_SELECTION,

    resetKanbanSelection: (tableId) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).selectedKanbanCardIds = EMPTY_KANBAN_SELECTION
        })
      )
    },

    // ─── DRAG & DROP ───────────────────────────────────────────────────────
    setActiveDragItems: (tableId, items) => {
      set((state) =>
        produce(state, (draft) => {
          ensureTable(draft, tableId).activeDragItems = items
        })
      )
    },

    getActiveDragItems: (tableId) => get().tables[tableId]?.activeDragItems ?? null,

    // ─── CLEANUP ───────────────────────────────────────────────────────────
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

/** Convenience selector for an individual table's range (referentially stable when unchanged) */
export function selectRange(tableId: string) {
  return (state: SelectionStore) => state.tables[tableId]?.range ?? null
}

/** Convenience selector for an individual table's editing cell */
export function selectEditingCell(tableId: string) {
  return (state: SelectionStore) => state.tables[tableId]?.editingCell ?? null
}

/** Re-export CellRange-related helpers from utils for convenience */
export type { CellAddress, CellRange, RangeEndpoint }

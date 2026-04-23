// apps/web/src/components/dynamic-table/context/cell-selection-context.tsx
'use client'

import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type {
  CellAddress,
  CellRange,
  CellSelectionConfig,
  CellSelectionState,
  RangeEndpoint,
} from '../types'
import { isSingleCell, rangeContains, singleRange } from '../utils/range'
import { useCellIndexerContext } from './cell-indexer-context'
import { useTableConfig } from './table-config-context'

// ============================================================================
// CONTEXT FOR CONFIG (static)
// ============================================================================

const CellSelectionConfigContext = createContext<CellSelectionConfig | undefined>(undefined)

interface CellSelectionConfigProviderProps {
  children: ReactNode
  config?: CellSelectionConfig
}

export function CellSelectionConfigProvider({
  children,
  config,
}: CellSelectionConfigProviderProps) {
  return (
    <CellSelectionConfigContext.Provider value={config}>
      {children}
    </CellSelectionConfigContext.Provider>
  )
}

export function useCellSelectionConfig(): CellSelectionConfig | undefined {
  return useContext(CellSelectionConfigContext)
}

// ============================================================================
// PRIMITIVE SELECTORS (preferred — return booleans, no per-move cell churn)
// ============================================================================

/** True for the anchor cell only (drives `.cell-active`, editor target, focus ring, paste origin) */
export function useIsActiveCell(rowId: string, columnId: string): boolean {
  const { tableId } = useTableConfig()
  return useSelectionStore((s) => {
    const r = s.tables[tableId]?.range
    if (!r) return false
    return r.anchor.rowId === rowId && r.anchor.columnId === columnId
  })
}

/**
 * True for any cell inside the current range *except* the anchor — drives
 * `.cell-in-range` fill tint. The anchor is styled separately as the active
 * cell. Returns false for the 1×1 case (anchor == focus, nothing to tint).
 */
export function useIsInRange(rowId: string, columnId: string): boolean {
  const { tableId } = useTableConfig()
  const indexer = useCellIndexerContext()
  return useSelectionStore((s) => {
    const r = s.tables[tableId]?.range
    if (!r || isSingleCell(r)) return false
    if (!indexer) return false
    const rowIdx = indexer.rowIdToIndex.get(rowId)
    const colIdx = indexer.columnIdToIndex.get(columnId)
    if (rowIdx === undefined || colIdx === undefined) return false
    if (!rangeContains(r, rowIdx, colIdx)) return false
    // Exclude the anchor — it's rendered as the active cell.
    return !(r.anchor.rowId === rowId && r.anchor.columnId === columnId)
  })
}

/**
 * True iff the marching-ants copy highlight is a single cell equal to this
 * cell. Combined with `isActive` at the render site, lets us suppress the
 * active cell's expansion so the dashed border sits on the cell rect rather
 * than on an expanded blob. Multi-cell copy ranges are ignored here — those
 * are already handled by the `.cell-in-range` gate.
 */
export function useIsCopySource(rowId: string, columnId: string): boolean {
  const { tableId } = useTableConfig()
  return useSelectionStore((s) => {
    const c = s.tables[tableId]?.copyHighlight
    if (!c || !isSingleCell(c)) return false
    return c.anchor.rowId === rowId && c.anchor.columnId === columnId
  })
}

/** True iff this cell is the editing target */
export function useIsEditingCell(rowId: string, columnId: string): boolean {
  const { tableId } = useTableConfig()
  return useSelectionStore((s) => {
    const e = s.tables[tableId]?.editingCell
    if (!e) return false
    return e.rowId === rowId && e.columnId === columnId
  })
}

/**
 * Active cell address (range.anchor — the cell the selection started from,
 * Excel-style). Subscribes to the two primitive ids so the snapshot stays
 * referentially stable when nothing changed — returning a fresh object inside
 * the selector would trip Zustand's getSnapshot loop.
 */
export function useActiveCell(): CellAddress | null {
  const { tableId } = useTableConfig()
  const rowId = useSelectionStore((s) => s.tables[tableId]?.range?.anchor.rowId ?? null)
  const columnId = useSelectionStore((s) => s.tables[tableId]?.range?.anchor.columnId ?? null)
  return useMemo(() => (rowId && columnId ? { rowId, columnId } : null), [rowId, columnId])
}

/** Current range (full object). Use sparingly — changes on every focus move. */
export function useRange(): CellRange | null {
  const { tableId } = useTableConfig()
  return useSelectionStore((s) => s.tables[tableId]?.range ?? null)
}

// ============================================================================
// ACTIONS
// ============================================================================

export interface CellRangeActions {
  setRange: (range: CellRange | null) => void
  setRangeFocus: (focus: RangeEndpoint) => void
  setActiveCell: (cell: CellAddress | null) => void
  setEditingCell: (cell: CellSelectionState | null) => void
  clearSelection: () => void
}

export function useRangeActions(): CellRangeActions {
  const { tableId } = useTableConfig()
  const setRange = useSelectionStore((s) => s.setRange)
  const setRangeFocus = useSelectionStore((s) => s.setRangeFocus)
  const setSelectedCell = useSelectionStore((s) => s.setSelectedCell)
  const setEditingCell = useSelectionStore((s) => s.setEditingCell)

  return useMemo(
    () => ({
      setRange: (range) => setRange(tableId, range),
      setRangeFocus: (focus) => setRangeFocus(tableId, focus),
      setActiveCell: (cell) => setSelectedCell(tableId, cell),
      setEditingCell: (cell) => setEditingCell(tableId, cell),
      clearSelection: () => setRange(tableId, null),
    }),
    [tableId, setRange, setRangeFocus, setSelectedCell, setEditingCell]
  )
}

// ============================================================================
// COMPAT SHIM — old useCellSelection() shape
// ============================================================================
// Old contract: returns `selectedCell` (1×1 only), setSelectedCell, editingCell,
// setEditingCell, cellSelectionConfig. Kept so non-cell consumers (table-body,
// dynamic-view) keep working without immediate changes.

interface CellSelectionContextValue {
  selectedCell: CellSelectionState | null
  setSelectedCell: (cell: CellSelectionState | null) => void
  editingCell: CellSelectionState | null
  setEditingCell: (cell: CellSelectionState | null) => void
  cellSelectionConfig?: CellSelectionConfig
}

export function useCellSelection(): CellSelectionContextValue {
  const { tableId } = useTableConfig()
  const cellSelectionConfig = useContext(CellSelectionConfigContext)

  // 1×1 shim: subscribe to the primitives that decide whether the shim is
  // populated, then build the object outside the selector so snapshots stay
  // referentially stable. Returning a fresh `{rowId, columnId}` *inside* the
  // selector would trip Zustand's getSnapshot loop.
  const isOneByOne = useSelectionStore((s) => {
    const r = s.tables[tableId]?.range
    return !!r && isSingleCell(r)
  })
  const focusRowId = useSelectionStore((s) => s.tables[tableId]?.range?.focus.rowId ?? null)
  const focusColumnId = useSelectionStore((s) => s.tables[tableId]?.range?.focus.columnId ?? null)
  const editingRowId = useSelectionStore((s) => s.tables[tableId]?.editingCell?.rowId ?? null)
  const editingColumnId = useSelectionStore((s) => s.tables[tableId]?.editingCell?.columnId ?? null)

  const storeSetSelectedCell = useSelectionStore((s) => s.setSelectedCell)
  const storeSetEditingCell = useSelectionStore((s) => s.setEditingCell)

  const setSelectedCell = useCallback(
    (cell: CellSelectionState | null) => storeSetSelectedCell(tableId, cell),
    [tableId, storeSetSelectedCell]
  )
  const setEditingCell = useCallback(
    (cell: CellSelectionState | null) => storeSetEditingCell(tableId, cell),
    [tableId, storeSetEditingCell]
  )

  const selectedCell = useMemo<CellSelectionState | null>(
    () =>
      isOneByOne && focusRowId && focusColumnId
        ? { rowId: focusRowId, columnId: focusColumnId }
        : null,
    [isOneByOne, focusRowId, focusColumnId]
  )
  const editingCell = useMemo<CellSelectionState | null>(
    () =>
      editingRowId && editingColumnId ? { rowId: editingRowId, columnId: editingColumnId } : null,
    [editingRowId, editingColumnId]
  )

  return useMemo(
    () => ({
      selectedCell,
      setSelectedCell,
      editingCell,
      setEditingCell,
      cellSelectionConfig,
    }),
    [selectedCell, setSelectedCell, editingCell, setEditingCell, cellSelectionConfig]
  )
}

export function useCellSelectionOptional(): CellSelectionContextValue | null {
  try {
    return useCellSelection()
  } catch {
    return null
  }
}

// Re-exports kept so external imports stay stable.
export { isSingleCell, rangeContains, singleRange }

// apps/web/src/components/dynamic-table/hooks/use-table-selectors.ts

import { useShallow } from 'zustand/react/shallow'
import type {
  SortingState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnPinningState,
  RowSelectionState,
} from '@tanstack/react-table'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { CellSelectionState, ColumnFormatting, KanbanViewConfig } from '../types'
import { useViewStore } from '../stores/view-store-new'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useSelectionStore } from '../stores/selection-store'

// ============================================================================
// STABLE REFERENCES (prevent unnecessary re-renders)
// ============================================================================

const EMPTY_ROW_SELECTION: RowSelectionState = {}
const EMPTY_SORTING: SortingState = []
const EMPTY_COLUMN_VISIBILITY: VisibilityState = {}
const EMPTY_COLUMN_ORDER: ColumnOrderState = []
const EMPTY_COLUMN_SIZING: ColumnSizingState = {}
const EMPTY_COLUMN_LABELS: Record<string, string> = {}
const EMPTY_COLUMN_FORMATTING: Record<string, ColumnFormatting> = {}
const EMPTY_KANBAN_CARD_IDS: Set<string> = new Set()

// ============================================================================
// FILTER SELECTORS
// ============================================================================

/** Get filters for current table/view */
export function useTableFilters(tableId: string): ConditionGroup[] {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useFilterStore(useShallow((state) => state.getActiveFilters(tableId, viewId ?? null)))
}

// ============================================================================
// UI CONFIG SELECTORS
// ============================================================================

/** Get sorting for current table/view */
export function useTableSorting(tableId: string): SortingState {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.sorting ?? EMPTY_SORTING
      }
      const saved = state.viewConfigs[viewId]?.sorting
      const pending = state.pendingConfigs[viewId]?.sorting
      return pending ?? saved ?? EMPTY_SORTING
    })
  )
}

/** Get column visibility for current table/view */
export function useColumnVisibility(tableId: string): VisibilityState {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.columnVisibility ?? EMPTY_COLUMN_VISIBILITY
      }
      const saved = state.viewConfigs[viewId]?.columnVisibility
      const pending = state.pendingConfigs[viewId]?.columnVisibility
      return pending ?? saved ?? EMPTY_COLUMN_VISIBILITY
    })
  )
}

/** Get column order for current table/view */
export function useColumnOrder(tableId: string): ColumnOrderState {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.columnOrder ?? EMPTY_COLUMN_ORDER
      }
      const saved = state.viewConfigs[viewId]?.columnOrder
      const pending = state.pendingConfigs[viewId]?.columnOrder
      return pending ?? saved ?? EMPTY_COLUMN_ORDER
    })
  )
}

/** Get column sizing for current table/view */
export function useColumnSizing(tableId: string): ColumnSizingState {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.columnSizing ?? EMPTY_COLUMN_SIZING
      }
      const saved = state.viewConfigs[viewId]?.columnSizing
      const pending = state.pendingConfigs[viewId]?.columnSizing
      return pending ?? saved ?? EMPTY_COLUMN_SIZING
    })
  )
}

/** Get column pinning for current table/view */
export function useColumnPinning(tableId: string): ColumnPinningState | undefined {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore((state) => {
    if (!viewId) {
      return state.sessionConfigs[tableId]?.columnPinning
    }
    const saved = state.viewConfigs[viewId]
    const pending = state.pendingConfigs[viewId]
    return pending?.columnPinning ?? saved?.columnPinning
  })
}

/** Get column labels for current table/view */
export function useColumnLabels(tableId: string): Record<string, string> {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.columnLabels ?? EMPTY_COLUMN_LABELS
      }
      const saved = state.viewConfigs[viewId]?.columnLabels
      const pending = state.pendingConfigs[viewId]?.columnLabels
      return pending ?? saved ?? EMPTY_COLUMN_LABELS
    })
  )
}

/** Get column formatting for current table/view */
export function useColumnFormatting(tableId: string): Record<string, ColumnFormatting> {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore(
    useShallow((state) => {
      if (!viewId) {
        return state.sessionConfigs[tableId]?.columnFormatting ?? EMPTY_COLUMN_FORMATTING
      }
      const saved = state.viewConfigs[viewId]?.columnFormatting
      const pending = state.pendingConfigs[viewId]?.columnFormatting
      return pending ?? saved ?? EMPTY_COLUMN_FORMATTING
    })
  )
}

/** Get view type for current table/view */
export function useViewType(tableId: string): 'table' | 'kanban' {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore((state) => {
    if (!viewId) {
      return state.sessionConfigs[tableId]?.viewType ?? 'table'
    }
    const saved = state.viewConfigs[viewId]
    const pending = state.pendingConfigs[viewId]
    return pending?.viewType ?? saved?.viewType ?? 'table'
  })
}

/** Get kanban config for current table/view */
export function useKanbanConfig(tableId: string): KanbanViewConfig | undefined {
  const viewId = useViewStore((state) => state.activeViewIds[tableId])
  return useTableUIStore((state) => {
    if (!viewId) {
      return state.sessionConfigs[tableId]?.kanban
    }
    const saved = state.viewConfigs[viewId]
    const pending = state.pendingConfigs[viewId]
    return pending?.kanban ?? saved?.kanban
  })
}

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

/** Get selected cell for table */
export function useSelectedCell(tableId: string): CellSelectionState | null {
  return useSelectionStore((state) => state.tables[tableId]?.selectedCell ?? null)
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

// ============================================================================
// VIEW METADATA SELECTORS (re-exported from view-store-new)
// ============================================================================

export { useTableViews, useActiveView, useActiveViewConfig } from '../stores/view-store-new'

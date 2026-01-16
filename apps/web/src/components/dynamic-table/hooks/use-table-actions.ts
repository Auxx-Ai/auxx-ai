// apps/web/src/components/dynamic-table/hooks/use-table-actions.ts

import { useCallback } from 'react'
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
import { useViewStore } from '../stores/view-store'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useSelectionStore } from '../stores/selection-store'

// ============================================================================
// FILTER ACTIONS
// ============================================================================

/** Get action to set filters */
export function useSetFilters(tableId: string) {
  return useCallback(
    (filters: ConditionGroup[]) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      if (viewId) {
        useFilterStore.getState().setViewFilters(viewId, filters)
      } else {
        useFilterStore.getState().setSessionFilters(tableId, filters)
      }
    },
    [tableId]
  )
}

// ============================================================================
// UI CONFIG ACTIONS
// ============================================================================

/** Get action to set sorting */
export function useSetSorting(tableId: string) {
  return useCallback(
    (sortingOrUpdater: SortingState | ((old: SortingState) => SortingState)) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      const store = useTableUIStore.getState()

      // Get current value
      const current = viewId
        ? store.viewConfigs[viewId]?.sorting ?? []
        : store.sessionConfigs[tableId]?.sorting ?? []

      // Resolve updater function if needed
      const sorting = typeof sortingOrUpdater === 'function'
        ? sortingOrUpdater(current)
        : sortingOrUpdater

      if (viewId) {
        store.updateViewConfig(viewId, { sorting })
      } else {
        store.updateSessionConfig(tableId, { sorting })
      }
    },
    [tableId]
  )
}

/** Get action to set column visibility */
export function useSetColumnVisibility(tableId: string) {
  return useCallback(
    (visibilityOrUpdater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      const store = useTableUIStore.getState()

      // Get current value
      const current = viewId
        ? store.viewConfigs[viewId]?.columnVisibility ?? {}
        : store.sessionConfigs[tableId]?.columnVisibility ?? {}

      // Resolve updater function if needed
      const columnVisibility = typeof visibilityOrUpdater === 'function'
        ? visibilityOrUpdater(current)
        : visibilityOrUpdater

      if (viewId) {
        store.updateViewConfig(viewId, { columnVisibility })
      } else {
        store.updateSessionConfig(tableId, { columnVisibility })
      }
    },
    [tableId]
  )
}

/** Get action to set column order */
export function useSetColumnOrder(tableId: string) {
  return useCallback(
    (columnOrder: ColumnOrderState) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      if (viewId) {
        useTableUIStore.getState().updateViewConfig(viewId, { columnOrder })
      } else {
        useTableUIStore.getState().updateSessionConfig(tableId, { columnOrder })
      }
    },
    [tableId]
  )
}

/** Get action to set column sizing */
export function useSetColumnSizing(tableId: string) {
  return useCallback(
    (sizingOrUpdater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      const store = useTableUIStore.getState()

      // Get current value
      const current = viewId
        ? store.viewConfigs[viewId]?.columnSizing ?? {}
        : store.sessionConfigs[tableId]?.columnSizing ?? {}

      // Resolve updater function if needed
      const columnSizing = typeof sizingOrUpdater === 'function'
        ? sizingOrUpdater(current)
        : sizingOrUpdater

      if (viewId) {
        store.updateViewConfig(viewId, { columnSizing })
      } else {
        store.updateSessionConfig(tableId, { columnSizing })
      }
    },
    [tableId]
  )
}

/** Get action to set column pinning */
export function useSetColumnPinning(tableId: string) {
  return useCallback(
    (pinningOrUpdater: ColumnPinningState | ((old: ColumnPinningState) => ColumnPinningState)) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      const store = useTableUIStore.getState()

      // Get current value
      const current = viewId
        ? store.viewConfigs[viewId]?.columnPinning ?? {}
        : store.sessionConfigs[tableId]?.columnPinning ?? {}

      // Resolve updater function if needed
      const columnPinning = typeof pinningOrUpdater === 'function'
        ? pinningOrUpdater(current)
        : pinningOrUpdater

      if (viewId) {
        store.updateViewConfig(viewId, { columnPinning })
      } else {
        store.updateSessionConfig(tableId, { columnPinning })
      }
    },
    [tableId]
  )
}

/** Get action to set column labels */
export function useSetColumnLabels(tableId: string) {
  return useCallback(
    (columnLabels: Record<string, string>) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      if (viewId) {
        useTableUIStore.getState().updateViewConfig(viewId, { columnLabels })
      } else {
        useTableUIStore.getState().updateSessionConfig(tableId, { columnLabels })
      }
    },
    [tableId]
  )
}

/** Get action to set column formatting */
export function useSetColumnFormatting(tableId: string) {
  return useCallback(
    (columnFormatting: Record<string, ColumnFormatting>) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      if (viewId) {
        useTableUIStore.getState().updateViewConfig(viewId, { columnFormatting })
      } else {
        useTableUIStore.getState().updateSessionConfig(tableId, { columnFormatting })
      }
    },
    [tableId]
  )
}

/** Get action to update kanban config */
export function useUpdateKanbanConfig(tableId: string) {
  return useCallback(
    (changes: Partial<KanbanViewConfig>) => {
      const viewId = useViewStore.getState().activeViewIds[tableId]
      if (viewId) {
        useTableUIStore.getState().updateKanbanConfig(viewId, changes)
      } else {
        const current = useTableUIStore.getState().getSessionConfig(tableId)
        useTableUIStore.getState().updateSessionConfig(tableId, {
          kanban: { ...current.kanban, ...changes } as KanbanViewConfig,
        })
      }
    },
    [tableId]
  )
}

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
      const selection = typeof selectionOrUpdater === 'function'
        ? selectionOrUpdater(current)
        : selectionOrUpdater

      console.log('[useSetRowSelection] handler called:', { tableId, selection })
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

// ============================================================================
// VIEW ACTIONS
// ============================================================================

/** Get action to set active view */
export function useSetActiveView(tableId: string) {
  return useCallback(
    (viewId: string | null) => {
      useViewStore.getState().setActiveView(tableId, viewId)
    },
    [tableId]
  )
}

// apps/web/src/components/dynamic-table/stores/store-actions.ts

import { useCallback } from 'react'
import { useDynamicTableStore } from './dynamic-table-store'
import type {
  SortingState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnPinningState,
} from '@tanstack/react-table'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ColumnFormatting, KanbanViewConfig } from '../types'

// ─── Filter Actions ───────────────────────────────────────────────────────────

/** Get action to set filters */
export function useSetFilters(tableId: string) {
  return useCallback((filters: ConditionGroup[]) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    if (viewId) {
      s.setViewFilters(viewId, filters)
      s.markDirty(viewId)
    } else {
      s.setSessionFilters(tableId, filters)
    }
  }, [tableId])
}

// ─── UI Config Actions ────────────────────────────────────────────────────────

/** Get action to set sorting */
export function useSetSorting(tableId: string) {
  return useCallback((sortingOrUpdater: SortingState | ((old: SortingState) => SortingState)) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.sorting ?? s.viewConfigs[viewId]?.sorting ?? [])
      : (s.sessionConfigs[tableId]?.sorting ?? [])
    const sorting = typeof sortingOrUpdater === 'function' ? sortingOrUpdater(current) : sortingOrUpdater

    if (viewId) {
      s.updateViewConfig(viewId, { sorting })
    } else {
      s.updateSessionConfig(tableId, { sorting })
    }
  }, [tableId])
}

/** Get action to set column visibility */
export function useSetColumnVisibility(tableId: string) {
  return useCallback((visibilityOrUpdater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.columnVisibility ?? s.viewConfigs[viewId]?.columnVisibility ?? {})
      : (s.sessionConfigs[tableId]?.columnVisibility ?? {})
    const columnVisibility = typeof visibilityOrUpdater === 'function' ? visibilityOrUpdater(current) : visibilityOrUpdater

    if (viewId) {
      s.updateViewConfig(viewId, { columnVisibility })
    } else {
      s.updateSessionConfig(tableId, { columnVisibility })
    }
  }, [tableId])
}

/** Get action to set column order */
export function useSetColumnOrder(tableId: string) {
  return useCallback((columnOrder: ColumnOrderState) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    if (viewId) {
      s.updateViewConfig(viewId, { columnOrder })
    } else {
      s.updateSessionConfig(tableId, { columnOrder })
    }
  }, [tableId])
}

/** Get action to set column sizing */
export function useSetColumnSizing(tableId: string) {
  return useCallback((sizingOrUpdater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.columnSizing ?? s.viewConfigs[viewId]?.columnSizing ?? {})
      : (s.sessionConfigs[tableId]?.columnSizing ?? {})
    const columnSizing = typeof sizingOrUpdater === 'function' ? sizingOrUpdater(current) : sizingOrUpdater

    if (viewId) {
      s.updateViewConfig(viewId, { columnSizing })
    } else {
      s.updateSessionConfig(tableId, { columnSizing })
    }
  }, [tableId])
}

/** Get action to set column pinning */
export function useSetColumnPinning(tableId: string) {
  return useCallback((pinningOrUpdater: ColumnPinningState | ((old: ColumnPinningState) => ColumnPinningState)) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.columnPinning ?? s.viewConfigs[viewId]?.columnPinning ?? {})
      : (s.sessionConfigs[tableId]?.columnPinning ?? {})
    const columnPinning = typeof pinningOrUpdater === 'function' ? pinningOrUpdater(current) : pinningOrUpdater

    if (viewId) {
      s.updateViewConfig(viewId, { columnPinning })
    } else {
      s.updateSessionConfig(tableId, { columnPinning })
    }
  }, [tableId])
}

/** Get action to set column labels */
export function useSetColumnLabels(tableId: string) {
  return useCallback((columnLabels: Record<string, string>) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    if (viewId) {
      s.updateViewConfig(viewId, { columnLabels })
    } else {
      s.updateSessionConfig(tableId, { columnLabels })
    }
  }, [tableId])
}

/** Get action to set column formatting */
export function useSetColumnFormatting(tableId: string) {
  return useCallback((columnFormatting: Record<string, ColumnFormatting>) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    if (viewId) {
      s.updateViewConfig(viewId, { columnFormatting })
    } else {
      s.updateSessionConfig(tableId, { columnFormatting })
    }
  }, [tableId])
}

/** Get action to update kanban config */
export function useUpdateKanbanConfig(tableId: string) {
  return useCallback((changes: Partial<KanbanViewConfig>) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    if (viewId) {
      s.updateKanbanConfig(viewId, changes)
    } else {
      const current = s.sessionConfigs[tableId]?.kanban ?? {}
      s.updateSessionConfig(tableId, { kanban: { ...current, ...changes } as KanbanViewConfig })
    }
  }, [tableId])
}

// ─── Single Column Actions ────────────────────────────────────────────────────

/** Set label for a single column */
export function useSetColumnLabel(tableId: string) {
  return useCallback((columnId: string, label: string | null) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.columnLabels ?? s.viewConfigs[viewId]?.columnLabels ?? {})
      : (s.sessionConfigs[tableId]?.columnLabels ?? {})

    const newLabels = { ...current }
    if (label === null) {
      delete newLabels[columnId]
    } else {
      newLabels[columnId] = label
    }

    if (viewId) {
      s.updateViewConfig(viewId, { columnLabels: newLabels })
    } else {
      s.updateSessionConfig(tableId, { columnLabels: newLabels })
    }
  }, [tableId])
}

/** Set formatting for a single column */
export function useSetSingleColumnFormatting(tableId: string) {
  return useCallback((columnId: string, formatting: ColumnFormatting | null) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]
    const current = viewId
      ? (s.pendingConfigs[viewId]?.columnFormatting ?? s.viewConfigs[viewId]?.columnFormatting ?? {})
      : (s.sessionConfigs[tableId]?.columnFormatting ?? {})

    const newFormatting = { ...current }
    if (formatting === null) {
      delete newFormatting[columnId]
    } else {
      newFormatting[columnId] = formatting
    }

    if (viewId) {
      s.updateViewConfig(viewId, { columnFormatting: newFormatting })
    } else {
      s.updateSessionConfig(tableId, { columnFormatting: newFormatting })
    }
  }, [tableId])
}

/** Set pinned column - pins all columns up to and including the target column */
export function useSetPinnedColumn(tableId: string, getAllColumnIds: () => string[]) {
  return useCallback((columnId: string | null) => {
    const s = useDynamicTableStore.getState()
    const viewId = s.activeViewIds[tableId]

    // When unpinning, clear all pinning
    if (columnId === null) {
      if (viewId) {
        s.updateViewConfig(viewId, { columnPinning: undefined })
      } else {
        s.updateSessionConfig(tableId, { columnPinning: undefined })
      }
      return
    }

    // When pinning, include all columns up to and including the target column
    const allColumnIds = getAllColumnIds()
    const targetIndex = allColumnIds.findIndex((id) => id === columnId)
    if (targetIndex === -1) return

    const leftColumns = allColumnIds.slice(0, targetIndex + 1)
    const newPinning = { left: leftColumns }

    if (viewId) {
      s.updateViewConfig(viewId, { columnPinning: newPinning })
    } else {
      s.updateSessionConfig(tableId, { columnPinning: newPinning })
    }
  }, [tableId, getAllColumnIds])
}

// ─── View Actions ─────────────────────────────────────────────────────────────

/** Get action to set active view */
export function useSetActiveView(tableId: string) {
  return useCallback((viewId: string | null) => {
    useDynamicTableStore.getState().setActiveView(tableId, viewId)
  }, [tableId])
}

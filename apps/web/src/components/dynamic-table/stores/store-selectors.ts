// apps/web/src/components/dynamic-table/stores/store-selectors.ts

import { useShallow } from 'zustand/react/shallow'
import { useDynamicTableStore } from './dynamic-table-store'
import type { TableView, ViewConfig, ColumnFormatting, KanbanViewConfig } from '../types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type {
  SortingState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnPinningState,
} from '@tanstack/react-table'
import {
  EMPTY_VIEWS,
  EMPTY_FILTERS,
  EMPTY_SORTING,
  EMPTY_COLUMN_ORDER,
  EMPTY_COLUMN_VISIBILITY,
  EMPTY_COLUMN_SIZING,
  EMPTY_COLUMN_LABELS,
  EMPTY_COLUMN_FORMATTING,
} from '../utils/constants'

// ─── View Selectors ───────────────────────────────────────────────────────────

/** Get all views for a table */
export function useTableViews(tableId: string): TableView[] {
  return useDynamicTableStore((s) => s.viewsByTableId[tableId] ?? EMPTY_VIEWS)
}

/** Get active view for a table */
export function useActiveView(tableId: string): TableView | null {
  return useDynamicTableStore((s) => s.getActiveView(tableId))
}

/** Get active view ID for a table */
export function useActiveViewId(tableId: string): string | null {
  return useDynamicTableStore((s) => s.activeViewIds[tableId] ?? null)
}

/** Check if store is initialized */
export function useViewStoreInitialized(): boolean {
  return useDynamicTableStore((s) => s.initialized)
}

/** Get the org's default field view for an entity and context type */
export function useOrgFieldView(
  entityDefinitionId: string,
  contextType: string
): TableView | null {
  return useDynamicTableStore((s) => {
    const views = s.viewsByTableId[entityDefinitionId] ?? EMPTY_VIEWS
    return views.find((v) => v.contextType === contextType && v.isDefault && v.isShared) ?? null
  })
}

// ─── Config Selectors ─────────────────────────────────────────────────────────

/**
 * Get merged config for active view.
 * NOTE: Prefer granular selectors (useTableFilters, useTableSorting, etc.) for better performance.
 * This selector is kept for backward compatibility but may cause extra re-renders.
 */
export function useActiveViewConfig(tableId: string): ViewConfig | null {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])

  // Select all the pieces separately with useShallow to avoid infinite loops
  const savedConfig = useDynamicTableStore(
    useShallow((s) => (viewId ? s.viewConfigs[viewId] : s.sessionConfigs[tableId]))
  )
  const pendingConfig = useDynamicTableStore(
    useShallow((s) => (viewId ? s.pendingConfigs[viewId] : undefined))
  )
  const filters = useDynamicTableStore(
    useShallow((s) =>
      viewId
        ? s.viewFilters[viewId] ?? EMPTY_FILTERS
        : s.sessionFilters[tableId] ?? EMPTY_FILTERS
    )
  )

  if (!savedConfig) return null

  // Merge and return - this object creation is fine since inputs are stable
  const merged = pendingConfig ? { ...savedConfig, ...pendingConfig } : savedConfig
  return { ...merged, filters } as ViewConfig
}

/** Get filters for current table/view */
export function useTableFilters(tableId: string): ConditionGroup[] {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) =>
      viewId
        ? s.viewFilters[viewId] ?? EMPTY_FILTERS
        : s.sessionFilters[tableId] ?? EMPTY_FILTERS
    )
  )
}

/** Get sorting for current table/view */
export function useTableSorting(tableId: string): SortingState {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.sorting ?? EMPTY_SORTING
      return s.pendingConfigs[viewId]?.sorting ?? s.viewConfigs[viewId]?.sorting ?? EMPTY_SORTING
    })
  )
}

/**
 * Get column visibility for current table/view.
 * Returns undefined if config not initialized yet (allows caller to use fallback).
 */
export function useColumnVisibility(tableId: string): VisibilityState | undefined {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (viewId) {
        // View mode: return from view config (pending takes precedence)
        return s.pendingConfigs[viewId]?.columnVisibility ?? s.viewConfigs[viewId]?.columnVisibility
      }
      // Session mode: return from session config (undefined if not initialized)
      return s.sessionConfigs[tableId]?.columnVisibility
    })
  )
}

/**
 * Get column order for current table/view.
 * Returns undefined if config not initialized yet (allows caller to use fallback).
 */
export function useColumnOrder(tableId: string): ColumnOrderState | undefined {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (viewId) {
        // View mode: return from view config (pending takes precedence)
        return s.pendingConfigs[viewId]?.columnOrder ?? s.viewConfigs[viewId]?.columnOrder
      }
      // Session mode: return from session config (undefined if not initialized)
      return s.sessionConfigs[tableId]?.columnOrder
    })
  )
}

/** Get column sizing for current table/view */
export function useColumnSizing(tableId: string): ColumnSizingState {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.columnSizing ?? EMPTY_COLUMN_SIZING
      return s.pendingConfigs[viewId]?.columnSizing ?? s.viewConfigs[viewId]?.columnSizing ?? EMPTY_COLUMN_SIZING
    })
  )
}

/** Get column pinning for current table/view */
export function useColumnPinning(tableId: string): ColumnPinningState | undefined {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.columnPinning
      return s.pendingConfigs[viewId]?.columnPinning ?? s.viewConfigs[viewId]?.columnPinning
    })
  )
}

/** Get column labels for current table/view */
export function useColumnLabels(tableId: string): Record<string, string> {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.columnLabels ?? EMPTY_COLUMN_LABELS
      return s.pendingConfigs[viewId]?.columnLabels ?? s.viewConfigs[viewId]?.columnLabels ?? EMPTY_COLUMN_LABELS
    })
  )
}

/** Get column formatting for current table/view */
export function useColumnFormatting(tableId: string): Record<string, ColumnFormatting> {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.columnFormatting ?? EMPTY_COLUMN_FORMATTING
      return s.pendingConfigs[viewId]?.columnFormatting ?? s.viewConfigs[viewId]?.columnFormatting ?? EMPTY_COLUMN_FORMATTING
    })
  )
}

/** Get view type for current table/view */
export function useViewType(tableId: string): 'table' | 'kanban' {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore((s) => {
    if (!viewId) return s.sessionConfigs[tableId]?.viewType ?? 'table'
    return s.pendingConfigs[viewId]?.viewType ?? s.viewConfigs[viewId]?.viewType ?? 'table'
  })
}

/** Get kanban config for current table/view */
export function useKanbanConfig(tableId: string): KanbanViewConfig | undefined {
  const viewId = useDynamicTableStore((s) => s.activeViewIds[tableId])
  return useDynamicTableStore(
    useShallow((s) => {
      if (!viewId) return s.sessionConfigs[tableId]?.kanban
      return s.pendingConfigs[viewId]?.kanban ?? s.viewConfigs[viewId]?.kanban
    })
  )
}

// ─── Status Selectors ─────────────────────────────────────────────────────────

/** Check if active view has unsaved changes */
export function useHasUnsavedChanges(tableId: string): boolean {
  return useDynamicTableStore((s) => {
    const viewId = s.activeViewIds[tableId]
    if (!viewId) return false
    return s.dirtyViewIds.has(viewId)
  })
}

/** Check if active view is saving */
export function useIsSaving(tableId: string): boolean {
  return useDynamicTableStore((s) => {
    const viewId = s.activeViewIds[tableId]
    if (!viewId) return false
    return s.savingViewIds.has(viewId)
  })
}

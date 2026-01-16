// apps/web/src/components/dynamic-table/stores/view-store-new.ts
'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { produce } from 'immer'
import type { TableView, ViewConfig } from '../types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useTableUIStore, type TableUIConfig } from './table-ui-store'
import { useFilterStore } from './filter-store'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Stable empty array to prevent unnecessary re-renders */
const EMPTY_FILTERS: ConditionGroup[] = []

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Convert ViewConfig to TableUIConfig (strips filters) */
function toTableUIConfig(config: ViewConfig): TableUIConfig {
  const { filters: _, ...uiConfig } = config
  return uiConfig as TableUIConfig
}

/** Extract filters from ViewConfig */
function extractFilters(config: ViewConfig): ConditionGroup[] {
  return config.filters ?? []
}

/** Merge TableUIConfig and filters back into ViewConfig */
function toViewConfig(uiConfig: TableUIConfig, filters: ConditionGroup[]): ViewConfig {
  return {
    ...uiConfig,
    filters,
  } as ViewConfig
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface ViewStoreState {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** All views keyed by tableId (metadata only) */
  viewsByTableId: Record<string, TableView[]>

  /** Active view ID per table */
  activeViewIds: Record<string, string | null>

  /** View IDs currently being saved */
  savingViewIds: Set<string>

  /** Whether initial fetch completed */
  initialized: boolean

  /** Last error */
  error: Error | null

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set all views from API (called on app init) */
  setAllViews: (views: TableView[]) => void

  /** Set views for a single table */
  setTableViews: (tableId: string, views: TableView[]) => void

  /** Mark as initialized */
  setInitialized: (value: boolean) => void

  /** Set error */
  setError: (error: Error | null) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set active view for a table */
  setActiveView: (tableId: string, viewId: string | null) => void

  /** Get active view ID for a table */
  getActiveViewId: (tableId: string) => string | null

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE (delegates to table-ui-store and filter-store)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Mark save as started */
  startSaving: (viewId: string) => void

  /** Mark save as finished */
  finishSaving: (viewId: string) => void

  /** Check if view is currently saving */
  isSaving: (viewId: string) => boolean

  /** Confirm save succeeded - updates both UI and filter stores */
  confirmSave: (viewId: string, savedConfig: ViewConfig) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Add a newly created view */
  addView: (view: TableView) => void

  /** Remove a deleted view */
  removeView: (viewId: string, tableId: string) => void

  /** Update view metadata (name, isDefault, etc.) */
  updateViewMeta: (
    viewId: string,
    meta: Partial<Pick<TableView, 'name' | 'isDefault' | 'isShared'>>
  ) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTORS (for backward compatibility)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get merged config (reads from table-ui-store and filter-store) */
  getMergedConfig: (viewId: string) => ViewConfig | null

  /** Check if view has unsaved changes (delegates to table-ui-store) */
  hasUnsavedChanges: (viewId: string) => boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /** Clear all state (on logout/org switch) */
  clearAll: () => void
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useViewStore = create<ViewStoreState>()(
  subscribeWithSelector((set, get) => ({
    // ─── INITIAL STATE ─────────────────────────────────────────────────────────
    viewsByTableId: {},
    activeViewIds: {},
    savingViewIds: new Set(),
    initialized: false,
    error: null,

    // ─── INITIALIZATION ────────────────────────────────────────────────────────
    setAllViews: (views) => {
      const byTable: Record<string, TableView[]> = {}

      // Group views by table and initialize both stores
      for (const view of views) {
        if (!byTable[view.tableId]) {
          byTable[view.tableId] = []
        }
        byTable[view.tableId].push(view)

        // Initialize table-ui-store with UI config
        const uiConfig = toTableUIConfig(view.config as ViewConfig)
        useTableUIStore.getState().setViewConfig(view.id, uiConfig)

        // Initialize filter-store with filters
        const filters = extractFilters(view.config as ViewConfig)
        useFilterStore.getState().setViewFilters(view.id, filters)
      }

      set({ viewsByTableId: byTable })
    },

    setTableViews: (tableId, views) => {
      set((state) => {
        // Initialize stores for each view
        for (const view of views) {
          const uiConfig = toTableUIConfig(view.config as ViewConfig)
          useTableUIStore.getState().setViewConfig(view.id, uiConfig)

          const filters = extractFilters(view.config as ViewConfig)
          useFilterStore.getState().setViewFilters(view.id, filters)
        }

        // Use produce for structural sharing
        return produce(state, (draft) => {
          draft.viewsByTableId[tableId] = views
        })
      })
    },

    setInitialized: (value) => set({ initialized: value }),

    setError: (error) => set({ error }),

    // ─── VIEW SELECTION ────────────────────────────────────────────────────────
    setActiveView: (tableId, viewId) => {
      set((state) => {
        // Early exit if value hasn't changed
        if (state.activeViewIds[tableId] === viewId) return state

        // Use produce for structural sharing
        return produce(state, (draft) => {
          draft.activeViewIds[tableId] = viewId
        })
      })
    },

    getActiveViewId: (tableId) => get().activeViewIds[tableId] ?? null,

    // ─── PERSISTENCE ───────────────────────────────────────────────────────────
    startSaving: (viewId) => {
      set((state) => {
        const newSaving = new Set(state.savingViewIds)
        newSaving.add(viewId)
        return { savingViewIds: newSaving }
      })
    },

    finishSaving: (viewId) => {
      set((state) => {
        const newSaving = new Set(state.savingViewIds)
        newSaving.delete(viewId)
        return { savingViewIds: newSaving }
      })
    },

    isSaving: (viewId) => get().savingViewIds.has(viewId),

    confirmSave: (viewId, savedConfig) => {
      // Update table-ui-store
      const uiConfig = toTableUIConfig(savedConfig)
      useTableUIStore.getState().confirmSave(viewId, uiConfig)

      // Update filter-store
      const filters = extractFilters(savedConfig)
      useFilterStore.getState().setViewFilters(viewId, filters)

      // Update view metadata
      set((state) =>
        produce(state, (draft) => {
          for (const tableId of Object.keys(draft.viewsByTableId)) {
            draft.viewsByTableId[tableId] = draft.viewsByTableId[tableId].map((v) =>
              v.id === viewId ? { ...v, config: savedConfig } : v
            )
          }
        })
      )
    },

    // ─── CRUD ──────────────────────────────────────────────────────────────────
    addView: (view) => {
      set((state) => {
        // Initialize stores for the new view
        const uiConfig = toTableUIConfig(view.config as ViewConfig)
        useTableUIStore.getState().setViewConfig(view.id, uiConfig)

        const filters = extractFilters(view.config as ViewConfig)
        useFilterStore.getState().setViewFilters(view.id, filters)

        // Use produce for structural sharing
        return produce(state, (draft) => {
          const tableViews = draft.viewsByTableId[view.tableId] ?? []
          draft.viewsByTableId[view.tableId] = [...tableViews, view]
        })
      })
    },

    removeView: (viewId, tableId) => {
      set((state) => {
        // Note: We intentionally don't clean up table-ui-store and filter-store
        // to allow undo operations. Cleanup happens on logout/org switch.

        // Use produce for structural sharing
        return produce(state, (draft) => {
          const tableViews = draft.viewsByTableId[tableId] ?? []
          draft.viewsByTableId[tableId] = tableViews.filter((v) => v.id !== viewId)
        })
      })
    },

    updateViewMeta: (viewId, meta) => {
      set((state) =>
        produce(state, (draft) => {
          for (const tableId of Object.keys(draft.viewsByTableId)) {
            draft.viewsByTableId[tableId] = draft.viewsByTableId[tableId].map((v) =>
              v.id === viewId ? { ...v, ...meta } : v
            )
          }
        })
      )
    },

    // ─── SELECTORS ─────────────────────────────────────────────────────────────
    getMergedConfig: (viewId) => {
      // Get UI config parts from table-ui-store
      const configParts = useTableUIStore.getState().getMergedConfig(viewId)
      if (!configParts) return null

      // Merge saved and pending configs if both exist
      const uiConfig =
        configParts.pending && configParts.saved
          ? { ...configParts.saved, ...configParts.pending }
          : configParts.saved

      if (!uiConfig) return null

      // Get filters from filter-store
      const filters = useFilterStore.getState().getViewFilters(viewId)

      // Merge them back into ViewConfig
      return toViewConfig(uiConfig, filters)
    },

    hasUnsavedChanges: (viewId) => {
      return useTableUIStore.getState().isDirty(viewId)
    },

    // ─── CLEANUP ───────────────────────────────────────────────────────────────
    clearAll: () => {
      set({
        viewsByTableId: {},
        activeViewIds: {},
        savingViewIds: new Set(),
        initialized: false,
        error: null,
      })

      // Also clear the other stores
      useTableUIStore.getState().clearAll()
      useFilterStore.getState().clearAll()
    },
  }))
)

// ═══════════════════════════════════════════════════════════════════════════
// SELECTOR HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/** Stable empty array to avoid infinite loops with selectors */
const EMPTY_VIEWS: TableView[] = []

/** Get all views for a table */
export function useTableViews(tableId: string): TableView[] {
  return useViewStore((state) => state.viewsByTableId[tableId] ?? EMPTY_VIEWS)
}

/** Get active view for a table */
export function useActiveView(tableId: string): TableView | null {
  return useViewStore((state) => {
    const viewId = state.activeViewIds[tableId]
    if (!viewId) return null
    const views = state.viewsByTableId[tableId] ?? EMPTY_VIEWS
    return views.find((v) => v.id === viewId) ?? null
  })
}

/** Get merged config for active view - delegates to table-ui-store and filter-store */
export function useActiveViewConfig(tableId: string): ViewConfig | null {
  // Get active view ID
  const viewId = useViewStore((state) => state.activeViewIds[tableId] ?? null)

  // If no view selected, get session config
  const sessionUIConfig = useTableUIStore((state) =>
    viewId ? null : (state.sessionConfigs[tableId] ?? null)
  )
  const sessionFilters = useFilterStore((state) =>
    viewId ? EMPTY_FILTERS : (state.sessionFilters[tableId] ?? EMPTY_FILTERS)
  )

  // If view selected, get saved and pending separately to avoid creating new objects
  const viewSavedConfig = useTableUIStore((state) =>
    viewId ? state.viewConfigs[viewId] : null
  )
  const viewPendingConfig = useTableUIStore((state) =>
    viewId ? state.pendingConfigs[viewId] : null
  )
  const viewFilters = useFilterStore((state) =>
    viewId ? (state.viewFilters[viewId] ?? EMPTY_FILTERS) : EMPTY_FILTERS
  )

  return useMemo(() => {
    if (!viewId) {
      // Session mode
      if (!sessionUIConfig) return null
      return toViewConfig(sessionUIConfig, sessionFilters)
    }

    // View mode - merge saved and pending configs
    if (!viewSavedConfig && !viewPendingConfig) return null

    // If no pending changes, return saved config directly (no merge needed)
    if (!viewPendingConfig) {
      return toViewConfig(viewSavedConfig!, viewFilters)
    }

    // If no saved config, return pending config directly
    if (!viewSavedConfig) {
      return toViewConfig(viewPendingConfig as TableUIConfig, viewFilters)
    }

    // Merge saved + pending
    const mergedConfig = { ...viewSavedConfig, ...viewPendingConfig }
    return toViewConfig(mergedConfig, viewFilters)
  }, [viewId, sessionUIConfig, sessionFilters, viewSavedConfig, viewPendingConfig, viewFilters])
}

/** Check if active view has unsaved changes */
export function useHasUnsavedChanges(tableId: string): boolean {
  return useViewStore((state) => {
    const viewId = state.activeViewIds[tableId]
    if (!viewId) return false
    return state.hasUnsavedChanges(viewId)
  })
}

/** Check if active view is saving */
export function useIsSaving(tableId: string): boolean {
  return useViewStore((state) => {
    const viewId = state.activeViewIds[tableId]
    if (!viewId) return false
    return state.savingViewIds.has(viewId)
  })
}

/** Check if store is initialized */
export function useViewStoreInitialized(): boolean {
  return useViewStore((state) => state.initialized)
}

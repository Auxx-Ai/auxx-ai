// apps/web/src/components/dynamic-table/stores/view-store.ts
'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { deepMerge } from '@auxx/lib/utils'
import type { TableView, ViewConfig, KanbanViewConfig } from '../types'

interface ViewStoreState {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** All views keyed by tableId */
  viewsByTableId: Record<string, TableView[]>

  /** Active view ID per table */
  activeViewIds: Record<string, string | null>

  /** Pending (unsaved) config changes per viewId */
  pendingConfigs: Record<string, Partial<ViewConfig>>

  /** Last confirmed server state per viewId */
  savedConfigs: Record<string, ViewConfig>

  /** View IDs with unsaved changes */
  dirtyViewIds: Set<string>

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
  // CONFIG UPDATES (OPTIMISTIC)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Update view config (partial, optimistic) */
  updateViewConfig: (viewId: string, changes: Partial<ViewConfig>) => void

  /** Update kanban-specific config (convenience helper) */
  updateKanbanConfig: (viewId: string, changes: Partial<KanbanViewConfig>) => void

  /** Mark a view as dirty (has pending changes) */
  markDirty: (viewId: string) => void

  /** Mark a view as clean (saved) */
  markClean: (viewId: string) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Confirm save succeeded - update savedConfigs, clear pending */
  confirmSave: (viewId: string, savedConfig: ViewConfig) => void

  /** Mark save as started */
  startSaving: (viewId: string) => void

  /** Mark save as finished */
  finishSaving: (viewId: string) => void

  /** Reset view to last saved state */
  resetToSaved: (viewId: string) => void

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
  // SELECTORS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get merged config (saved + pending) */
  getMergedConfig: (viewId: string) => ViewConfig | null

  /** Check if view has unsaved changes */
  hasUnsavedChanges: (viewId: string) => boolean

  /** Check if view is currently saving */
  isSaving: (viewId: string) => boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /** Clear all state (on logout/org switch) */
  clearAll: () => void
}

export const useViewStore = create<ViewStoreState>()(
  subscribeWithSelector((set, get) => ({
    // ─── INITIAL STATE ─────────────────────────────────────────────────────────
    viewsByTableId: {},
    activeViewIds: {},
    pendingConfigs: {},
    savedConfigs: {},
    dirtyViewIds: new Set(),
    savingViewIds: new Set(),
    initialized: false,
    error: null,

    // ─── INITIALIZATION ────────────────────────────────────────────────────────
    setAllViews: (views) => {
      const byTable: Record<string, TableView[]> = {}
      const savedConfigs: Record<string, ViewConfig> = {}

      for (const view of views) {
        if (!byTable[view.tableId]) {
          byTable[view.tableId] = []
        }
        byTable[view.tableId].push(view)
        savedConfigs[view.id] = view.config as ViewConfig
      }

      set({ viewsByTableId: byTable, savedConfigs })
    },

    setTableViews: (tableId, views) => {
      set((state) => {
        const savedConfigs = { ...state.savedConfigs }
        for (const view of views) {
          savedConfigs[view.id] = view.config as ViewConfig
        }
        return {
          viewsByTableId: { ...state.viewsByTableId, [tableId]: views },
          savedConfigs,
        }
      })
    },

    setInitialized: (value) => set({ initialized: value }),

    setError: (error) => set({ error }),

    // ─── VIEW SELECTION ────────────────────────────────────────────────────────
    setActiveView: (tableId, viewId) => {
      set((state) => ({
        activeViewIds: { ...state.activeViewIds, [tableId]: viewId },
      }))
    },

    getActiveViewId: (tableId) => get().activeViewIds[tableId] ?? null,

    // ─── CONFIG UPDATES ────────────────────────────────────────────────────────
    updateViewConfig: (viewId, changes) => {
      set((state) => {
        const currentPending = state.pendingConfigs[viewId] ?? {}
        const merged = deepMerge(
          currentPending as Record<string, unknown>,
          changes as Record<string, unknown>
        ) as Partial<ViewConfig>

        const newDirty = new Set(state.dirtyViewIds)
        newDirty.add(viewId)

        return {
          pendingConfigs: { ...state.pendingConfigs, [viewId]: merged },
          dirtyViewIds: newDirty,
        }
      })
    },

    updateKanbanConfig: (viewId, changes) => {
      const { updateViewConfig, getMergedConfig } = get()
      const current = getMergedConfig(viewId)
      if (!current) return

      const currentKanban = current.kanban ?? {}
      updateViewConfig(viewId, {
        kanban: deepMerge(
          currentKanban as Record<string, unknown>,
          changes as Record<string, unknown>
        ) as KanbanViewConfig,
      })
    },

    markDirty: (viewId) => {
      set((state) => {
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.add(viewId)
        return { dirtyViewIds: newDirty }
      })
    },

    markClean: (viewId) => {
      set((state) => {
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)
        return { dirtyViewIds: newDirty }
      })
    },

    // ─── PERSISTENCE ───────────────────────────────────────────────────────────
    confirmSave: (viewId, savedConfig) => {
      set((state) => {
        const { [viewId]: _, ...restPending } = state.pendingConfigs
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)

        // Also update the view in viewsByTableId
        const newViewsByTableId = { ...state.viewsByTableId }
        for (const tableId of Object.keys(newViewsByTableId)) {
          newViewsByTableId[tableId] = newViewsByTableId[tableId].map((v) =>
            v.id === viewId ? { ...v, config: savedConfig } : v
          )
        }

        return {
          savedConfigs: { ...state.savedConfigs, [viewId]: savedConfig },
          pendingConfigs: restPending,
          dirtyViewIds: newDirty,
          viewsByTableId: newViewsByTableId,
        }
      })
    },

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

    resetToSaved: (viewId) => {
      set((state) => {
        const { [viewId]: _, ...restPending } = state.pendingConfigs
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)
        return {
          pendingConfigs: restPending,
          dirtyViewIds: newDirty,
        }
      })
    },

    // ─── CRUD ──────────────────────────────────────────────────────────────────
    addView: (view) => {
      set((state) => {
        const tableViews = state.viewsByTableId[view.tableId] ?? []
        return {
          viewsByTableId: {
            ...state.viewsByTableId,
            [view.tableId]: [...tableViews, view],
          },
          savedConfigs: {
            ...state.savedConfigs,
            [view.id]: view.config as ViewConfig,
          },
        }
      })
    },

    removeView: (viewId, tableId) => {
      set((state) => {
        const tableViews = state.viewsByTableId[tableId] ?? []
        const { [viewId]: _saved, ...restSaved } = state.savedConfigs
        const { [viewId]: _pending, ...restPending } = state.pendingConfigs

        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)

        const newSaving = new Set(state.savingViewIds)
        newSaving.delete(viewId)

        return {
          viewsByTableId: {
            ...state.viewsByTableId,
            [tableId]: tableViews.filter((v) => v.id !== viewId),
          },
          savedConfigs: restSaved,
          pendingConfigs: restPending,
          dirtyViewIds: newDirty,
          savingViewIds: newSaving,
        }
      })
    },

    updateViewMeta: (viewId, meta) => {
      set((state) => {
        const newViewsByTableId = { ...state.viewsByTableId }
        for (const tableId of Object.keys(newViewsByTableId)) {
          newViewsByTableId[tableId] = newViewsByTableId[tableId].map((v) =>
            v.id === viewId ? { ...v, ...meta } : v
          )
        }
        return { viewsByTableId: newViewsByTableId }
      })
    },

    // ─── SELECTORS ─────────────────────────────────────────────────────────────
    getMergedConfig: (viewId) => {
      const { savedConfigs, pendingConfigs } = get()
      const saved = savedConfigs[viewId]
      if (!saved) return null

      const pending = pendingConfigs[viewId]
      if (!pending) return saved

      return deepMerge(
        saved as Record<string, unknown>,
        pending as Record<string, unknown>
      ) as ViewConfig
    },

    hasUnsavedChanges: (viewId) => get().dirtyViewIds.has(viewId),

    isSaving: (viewId) => get().savingViewIds.has(viewId),

    // ─── CLEANUP ───────────────────────────────────────────────────────────────
    clearAll: () => {
      set({
        viewsByTableId: {},
        activeViewIds: {},
        pendingConfigs: {},
        savedConfigs: {},
        dirtyViewIds: new Set(),
        savingViewIds: new Set(),
        initialized: false,
        error: null,
      })
    },
  }))
)

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTOR HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

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

/** Get merged config for active view - use primitive dependencies for stable results */
export function useActiveViewConfig(tableId: string): ViewConfig | null {
  // Subscribe to primitive values that indicate when config changes
  const viewId = useViewStore((state) => state.activeViewIds[tableId] ?? null)
  const savedConfig = useViewStore((state) => (viewId ? state.savedConfigs[viewId] : null))
  const pendingConfig = useViewStore((state) => (viewId ? state.pendingConfigs[viewId] : null))

  // Memoize the merged result - only recompute when saved/pending actually changes
  return useMemo(() => {
    if (!viewId || !savedConfig) return null
    if (!pendingConfig) return savedConfig

    return deepMerge(
      savedConfig as Record<string, unknown>,
      pendingConfig as Record<string, unknown>
    ) as ViewConfig
  }, [viewId, savedConfig, pendingConfig])
}

/** Get kanban config for active view */
export function useActiveKanbanConfig(tableId: string): KanbanViewConfig | null {
  // Subscribe to the specific kanban parts to avoid unnecessary re-renders
  const viewId = useViewStore((state) => state.activeViewIds[tableId] ?? null)
  const savedKanban = useViewStore((state) =>
    viewId ? (state.savedConfigs[viewId]?.kanban ?? null) : null
  )
  const pendingKanban = useViewStore((state) =>
    viewId ? (state.pendingConfigs[viewId]?.kanban ?? null) : null
  )

  // Memoize the merged result
  return useMemo(() => {
    if (!viewId || !savedKanban) return null
    if (!pendingKanban) return savedKanban

    return deepMerge(
      savedKanban as Record<string, unknown>,
      pendingKanban as Record<string, unknown>
    ) as KanbanViewConfig
  }, [viewId, savedKanban, pendingKanban])
}

/** Check if active view has unsaved changes */
export function useHasUnsavedChanges(tableId: string): boolean {
  return useViewStore((state) => {
    const viewId = state.activeViewIds[tableId]
    if (!viewId) return false
    return state.dirtyViewIds.has(viewId)
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

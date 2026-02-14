// apps/web/src/components/dynamic-table/stores/shared-slice.ts

import type { ViewConfig } from '../types'
import { EMPTY_FILTERS, EMPTY_VIEWS } from '../utils/constants'
import type { SharedSlice, SliceCreator, TableUIConfig } from './store-types'

/** Merge UI config with filters to create ViewConfig */
function toViewConfig(uiConfig: TableUIConfig, filters: typeof EMPTY_FILTERS): ViewConfig {
  return { ...uiConfig, filters } as ViewConfig
}

/** Creates the shared slice for dirty tracking, coordination, and computed getters */
export const createSharedSlice: SliceCreator<SharedSlice> = (set, get) => ({
  dirtyViewIds: new Set(),

  markDirty: (viewId) => {
    set((state) => {
      state.dirtyViewIds = new Set([...state.dirtyViewIds, viewId])
    })
  },

  markClean: (viewId) => {
    set((state) => {
      const next = new Set(state.dirtyViewIds)
      next.delete(viewId)
      state.dirtyViewIds = next
    })
  },

  isDirty: (viewId) => get().dirtyViewIds.has(viewId),
  isSaving: (viewId) => get().savingViewIds.has(viewId),
  hasUnsavedChanges: (viewId) => get().dirtyViewIds.has(viewId),

  confirmSave: (viewId, savedConfig) => {
    const { filters, ...uiConfig } = savedConfig

    set((state) => {
      state.viewConfigs[viewId] = uiConfig as TableUIConfig
      delete state.pendingConfigs[viewId]
      state.viewFilters[viewId] = filters ?? EMPTY_FILTERS
      const nextDirty = new Set(state.dirtyViewIds)
      nextDirty.delete(viewId)
      state.dirtyViewIds = nextDirty
    })

    // Update view metadata
    for (const tableId of Object.keys(get().viewsByTableId)) {
      const views = get().viewsByTableId[tableId] ?? []
      const idx = views.findIndex((v) => v.id === viewId)
      if (idx !== -1) {
        set((s) => {
          const tableViews = s.viewsByTableId[tableId]
          if (tableViews?.[idx]) {
            tableViews[idx] = { ...tableViews[idx], config: savedConfig }
          }
        })
        break
      }
    }
  },

  resetViewChanges: (viewId) => {
    get().resetToSaved(viewId)

    // Reset filters to saved
    const allViews = Object.values(get().viewsByTableId).flat()
    const view = allViews.find((v) => v.id === viewId)
    if (view) {
      get().setViewFilters(viewId, (view.config as ViewConfig).filters ?? EMPTY_FILTERS)
    }

    get().markClean(viewId)
  },

  clearAll: () => {
    set((state) => {
      state.viewsByTableId = {}
      state.activeViewIds = {}
      state.savingViewIds = new Set()
      state.initialized = false
      state.error = null
      state.viewConfigs = {}
      state.pendingConfigs = {}
      state.sessionConfigs = {}
      state.viewFilters = {}
      state.sessionFilters = {}
      state.dirtyViewIds = new Set()
    })
  },

  getActiveViewId: (tableId) => get().activeViewIds[tableId] ?? null,

  getActiveView: (tableId) => {
    const viewId = get().activeViewIds[tableId]
    if (!viewId) return null
    const views = get().viewsByTableId[tableId] ?? EMPTY_VIEWS
    return views.find((v) => v.id === viewId) ?? null
  },

  getActiveViewConfig: (tableId) => {
    const viewId = get().activeViewIds[tableId]

    if (!viewId) {
      const sessionUI = get().sessionConfigs[tableId]
      if (!sessionUI) return null
      const sessionFilters = get().sessionFilters[tableId] ?? EMPTY_FILTERS
      return toViewConfig(sessionUI, sessionFilters)
    }

    const savedUI = get().viewConfigs[viewId]
    if (!savedUI) return null

    const pendingUI = get().pendingConfigs[viewId]
    const filters = get().viewFilters[viewId] ?? EMPTY_FILTERS
    const mergedUI = pendingUI ? { ...savedUI, ...pendingUI } : savedUI

    return toViewConfig(mergedUI as TableUIConfig, filters)
  },

  getActiveFilters: (tableId) => {
    const viewId = get().activeViewIds[tableId]
    if (viewId) return get().viewFilters[viewId] ?? EMPTY_FILTERS
    return get().sessionFilters[tableId] ?? EMPTY_FILTERS
  },
})

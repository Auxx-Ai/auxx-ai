// apps/web/src/components/dynamic-table/stores/view-slice.ts

import type { SliceCreator, ViewSlice, TableUIConfig } from './store-types'
import type { ViewConfig } from '../types'
import type { ViewContextType, FieldViewConfig } from '@auxx/lib/conditions'
import { EMPTY_FILTERS } from '../utils/constants'

/** Extract UI config from ViewConfig (strips filters) */
function toUIConfig(config: ViewConfig): TableUIConfig {
  const { filters: _, ...uiConfig } = config
  return uiConfig as TableUIConfig
}

/** Creates the view slice for managing view metadata and selection */
export const createViewSlice: SliceCreator<ViewSlice> = (set, get) => ({
  viewsByTableId: {},
  activeViewIds: {},
  savingViewIds: new Set(),
  initialized: false,
  error: null,

  setAllViews: (views) => {
    const byTable: Record<string, typeof views> = {}

    for (const view of views) {
      if (!byTable[view.tableId]) byTable[view.tableId] = []
      byTable[view.tableId].push(view)

      // Initialize other slices
      const config = view.config as ViewConfig
      get().setViewConfig(view.id, toUIConfig(config))
      get().setViewFilters(view.id, config.filters ?? EMPTY_FILTERS)
    }

    set((state) => {
      state.viewsByTableId = byTable
      state.initialized = true
    })
  },

  setTableViews: (tableId, views) => {
    for (const view of views) {
      const config = view.config as ViewConfig
      get().setViewConfig(view.id, toUIConfig(config))
      get().setViewFilters(view.id, config.filters ?? EMPTY_FILTERS)
    }
    set((state) => {
      state.viewsByTableId[tableId] = views
    })
  },

  setActiveView: (tableId, viewId) => {
    set((state) => {
      if (state.activeViewIds[tableId] === viewId) return
      state.activeViewIds[tableId] = viewId
    })
  },

  setInitialized: (value) => set((state) => { state.initialized = value }),
  setError: (error) => set((state) => { state.error = error }),

  addView: (view) => {
    const config = view.config as ViewConfig
    get().setViewConfig(view.id, toUIConfig(config))
    get().setViewFilters(view.id, config.filters ?? EMPTY_FILTERS)

    set((state) => {
      const tableViews = state.viewsByTableId[view.tableId] ?? []
      state.viewsByTableId[view.tableId] = [...tableViews, view]
    })
  },

  removeView: (viewId, tableId) => {
    set((state) => {
      state.viewsByTableId[tableId] = (state.viewsByTableId[tableId] ?? [])
        .filter((v) => v.id !== viewId)
    })
  },

  updateViewMeta: (viewId, meta) => {
    set((state) => {
      for (const tableId of Object.keys(state.viewsByTableId)) {
        state.viewsByTableId[tableId] = state.viewsByTableId[tableId].map((v) =>
          v.id === viewId ? { ...v, ...meta } : v
        )
      }
    })
  },

  startSaving: (viewId) => {
    set((state) => {
      state.savingViewIds = new Set([...state.savingViewIds, viewId])
    })
  },

  finishSaving: (viewId) => {
    set((state) => {
      const next = new Set(state.savingViewIds)
      next.delete(viewId)
      state.savingViewIds = next
    })
  },

  toggleFieldVisibility: (tableId, contextType, resourceFieldId, visible) => {
    set((state) => {
      const views = state.viewsByTableId[tableId] ?? []
      const viewIndex = views.findIndex(
        (v) => v.contextType === contextType && v.isDefault && v.isShared
      )
      if (viewIndex === -1) return

      const view = views[viewIndex]
      const config = view.config as FieldViewConfig

      const updatedConfig: FieldViewConfig = {
        ...config,
        fieldVisibility: {
          ...config.fieldVisibility,
          [resourceFieldId]: visible,
        },
      }

      state.viewsByTableId[tableId][viewIndex] = { ...view, config: updatedConfig }
    })
  },

  reorderFieldInView: (tableId, contextType, fromIndex, toIndex) => {
    set((state) => {
      const views = state.viewsByTableId[tableId] ?? []
      const viewIndex = views.findIndex(
        (v) => v.contextType === contextType && v.isDefault && v.isShared
      )
      if (viewIndex === -1) return

      const view = views[viewIndex]
      const config = view.config as FieldViewConfig
      const newOrder = [...config.fieldOrder]
      const [moved] = newOrder.splice(fromIndex, 1)
      if (!moved) return
      newOrder.splice(toIndex, 0, moved)

      state.viewsByTableId[tableId][viewIndex] = {
        ...view,
        config: { ...config, fieldOrder: newOrder },
      }
    })
  },
})

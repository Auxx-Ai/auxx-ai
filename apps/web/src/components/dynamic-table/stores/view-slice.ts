// apps/web/src/components/dynamic-table/stores/view-slice.ts

import type { FieldViewConfig } from '@auxx/lib/conditions/client'
import type { ViewConfig } from '../types'
import { EMPTY_FILTERS } from '../utils/constants'
import type { SliceCreator, TableUIConfig, ViewSlice } from './store-types'

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
      const tableViews = byTable[view.tableId] ?? []
      tableViews.push(view)
      byTable[view.tableId] = tableViews

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
      const previousViewId = state.activeViewIds[tableId]
      if (previousViewId === viewId) return

      const previousView = state.viewsByTableId[tableId]?.find(
        (candidate) => candidate.id === previousViewId
      )
      if (previousView?.isShared && previousViewId) {
        const previousConfig = state.personalConfigs[previousViewId]
        if (previousConfig) {
          delete previousConfig.sorting
          if (Object.keys(previousConfig).length === 0) {
            delete state.personalConfigs[previousViewId]
          }
        }
        delete state.personalFilters[previousViewId]
      }

      state.activeViewIds[tableId] = viewId
    })
  },

  setInitialized: (value) =>
    set((state) => {
      state.initialized = value
    }),
  setError: (error) =>
    set((state) => {
      state.error = error
    }),

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
      state.viewsByTableId[tableId] = (state.viewsByTableId[tableId] ?? []).filter(
        (v) => v.id !== viewId
      )
    })
  },

  updateViewMeta: (viewId, meta) => {
    set((state) => {
      for (const tableId of Object.keys(state.viewsByTableId)) {
        const tableViews = state.viewsByTableId[tableId]
        if (tableViews) {
          state.viewsByTableId[tableId] = tableViews.map((view) =>
            view.id === viewId ? { ...view, ...meta } : view
          )
        }
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
      if (!view) return
      const config = view.config as unknown as FieldViewConfig

      const updatedConfig: FieldViewConfig = {
        ...config,
        fieldVisibility: {
          ...config.fieldVisibility,
          [resourceFieldId]: visible,
        },
      }

      views[viewIndex] = { ...view, config: updatedConfig as unknown as ViewConfig }
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
      if (!view) return
      const config = view.config as unknown as FieldViewConfig
      const newOrder = [...config.fieldOrder]
      const [moved] = newOrder.splice(fromIndex, 1)
      if (!moved) return
      newOrder.splice(toIndex, 0, moved)

      views[viewIndex] = {
        ...view,
        config: { ...config, fieldOrder: newOrder } as unknown as ViewConfig,
      }
    })
  },
})

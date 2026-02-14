// apps/web/src/components/dynamic-table/stores/filter-slice.ts

import type { FilterSlice, SliceCreator } from './store-types'

/** Creates the filter slice for managing filter conditions */
export const createFilterSlice: SliceCreator<FilterSlice> = (set, get) => ({
  viewFilters: {},
  sessionFilters: {},

  setViewFilters: (viewId, filters) => {
    set((state) => {
      state.viewFilters[viewId] = filters
    })
  },

  setSessionFilters: (tableId, filters) => {
    set((state) => {
      state.sessionFilters[tableId] = filters
    })
  },

  clearSessionFilters: (tableId) => {
    set((state) => {
      delete state.sessionFilters[tableId]
    })
  },
})

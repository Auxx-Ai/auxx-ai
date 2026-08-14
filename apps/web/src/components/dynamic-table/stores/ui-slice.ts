// apps/web/src/components/dynamic-table/stores/ui-slice.ts

import type { CalendarViewConfig, KanbanViewConfig } from '../types'
import { tableViewPreferenceKey } from '../utils/constants'
import { toPersonalOverlayConfig } from '../utils/table-view-preference'
import type { SliceCreator, UISlice } from './store-types'
import { DEFAULT_UI_CONFIG } from './store-types'

/** Creates the UI slice for managing visual/layout config */
export const createUISlice: SliceCreator<UISlice> = (set, get) => ({
  viewConfigs: {},
  pendingConfigs: {},
  personalConfigs: {},
  viewPreferences: {},
  sessionConfigs: {},

  setViewConfig: (viewId, config) => {
    set((state) => {
      state.viewConfigs[viewId] = config
    })
  },

  updateViewConfig: (viewId, changes) => {
    set((state) => {
      const current = state.pendingConfigs[viewId] ?? {}
      state.pendingConfigs[viewId] = { ...current, ...changes }
    })
    get().markDirty(viewId)
  },

  setViewPreferences: (preferences) => {
    set((state) => {
      state.viewPreferences = {}
      for (const preference of preferences) {
        state.viewPreferences[tableViewPreferenceKey(preference.tableId, preference.tableViewId)] =
          preference
        if (preference.tableViewId) {
          state.personalConfigs[preference.tableViewId] = toPersonalOverlayConfig(preference.config)
        }
      }
    })
  },

  upsertViewPreference: (preference) => {
    set((state) => {
      state.viewPreferences[tableViewPreferenceKey(preference.tableId, preference.tableViewId)] =
        preference
    })
  },

  clearViewPreference: (tableId, tableViewId) => {
    set((state) => {
      delete state.viewPreferences[tableViewPreferenceKey(tableId, tableViewId)]
    })
  },

  updatePersonalConfig: (viewId, changes) => {
    set((state) => {
      const current = state.personalConfigs[viewId] ?? {}
      state.personalConfigs[viewId] = { ...current, ...changes }
    })
  },

  clearPersonalConfig: (viewId) => {
    set((state) => {
      delete state.personalConfigs[viewId]
    })
  },

  updateSessionConfig: (tableId, changes) => {
    set((state) => {
      const current = state.sessionConfigs[tableId] ?? DEFAULT_UI_CONFIG
      state.sessionConfigs[tableId] = { ...current, ...changes }
    })
  },

  updateKanbanConfig: (viewId, changes) => {
    const saved = get().viewConfigs[viewId]
    const pending = get().pendingConfigs[viewId]
    const currentKanban = pending?.kanban ?? saved?.kanban ?? {}

    get().updateViewConfig(viewId, {
      kanban: { ...currentKanban, ...changes } as KanbanViewConfig,
    })
  },

  updateCalendarConfig: (viewId, changes) => {
    const saved = get().viewConfigs[viewId]
    const pending = get().pendingConfigs[viewId]
    const currentCalendar = pending?.calendar ?? saved?.calendar ?? {}

    get().updateViewConfig(viewId, {
      calendar: { ...currentCalendar, ...changes } as CalendarViewConfig,
    })
  },

  resetToSaved: (viewId) => {
    set((state) => {
      delete state.pendingConfigs[viewId]
    })
  },

  getSessionConfig: (tableId) => get().sessionConfigs[tableId] ?? DEFAULT_UI_CONFIG,
})

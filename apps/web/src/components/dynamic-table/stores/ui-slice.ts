// apps/web/src/components/dynamic-table/stores/ui-slice.ts

import type { SliceCreator, UISlice, TableUIConfig } from './store-types'
import type { KanbanViewConfig } from '../types'
import { DEFAULT_UI_CONFIG } from './store-types'

/** Creates the UI slice for managing visual/layout config */
export const createUISlice: SliceCreator<UISlice> = (set, get) => ({
  viewConfigs: {},
  pendingConfigs: {},
  sessionConfigs: {},

  setViewConfig: (viewId, config) => {
    set((state) => { state.viewConfigs[viewId] = config })
  },

  updateViewConfig: (viewId, changes) => {
    set((state) => {
      const current = state.pendingConfigs[viewId] ?? {}
      state.pendingConfigs[viewId] = { ...current, ...changes }
    })
    get().markDirty(viewId)
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

  resetToSaved: (viewId) => {
    set((state) => { delete state.pendingConfigs[viewId] })
  },

  getSessionConfig: (tableId) => get().sessionConfigs[tableId] ?? DEFAULT_UI_CONFIG,
})

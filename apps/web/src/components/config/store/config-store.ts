// apps/web/src/components/config/store/config-store.ts
'use client'

import type { ConfigSource, ConfigVariableGroup } from '@auxx/types/config'
import { create } from 'zustand'

/** Config store state */
interface ConfigStoreState {
  /** Text search filter */
  search: string
  /** Filter by source (ALL = no filter) */
  sourceFilter: ConfigSource | 'ALL'
  /** Filter by group (null = all groups) */
  groupFilter: ConfigVariableGroup | null
  /** Collapsed group sections */
  collapsedGroups: Set<string>
}

/** Config store actions */
interface ConfigStoreActions {
  setSearch: (search: string) => void
  setSourceFilter: (filter: ConfigSource | 'ALL') => void
  setGroupFilter: (group: ConfigVariableGroup | null) => void
  toggleGroupCollapsed: (group: string) => void
  resetFilters: () => void
}

type ConfigStore = ConfigStoreState & ConfigStoreActions

/**
 * Zustand store for config variable page state.
 * Handles search, filtering, and UI state.
 */
export const useConfigStore = create<ConfigStore>((set) => ({
  // State
  search: '',
  sourceFilter: 'ALL',
  groupFilter: null,
  collapsedGroups: new Set(),

  // Actions
  setSearch: (search) => set({ search }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter }),
  setGroupFilter: (groupFilter) => set({ groupFilter }),
  toggleGroupCollapsed: (group) =>
    set((state) => {
      const next = new Set(state.collapsedGroups)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return { collapsedGroups: next }
    }),
  resetFilters: () =>
    set({
      search: '',
      sourceFilter: 'ALL',
      groupFilter: null,
    }),
}))

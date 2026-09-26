// apps/web/src/components/dynamic-table/stores/group-collapse-slice.ts

import type { GroupCollapseSlice, SliceCreator } from './store-types'

export { EMPTY_GROUP_KEY } from '@auxx/lib/resources/grouping/client'

/** Scope for one table/view/group-field combination in `collapsedGroups`. */
export function groupCollapseScopeKey(
  tableId: string,
  viewId: string | null,
  groupByFieldId: string
): string {
  return `${tableId}:${viewId ?? 'default'}:${groupByFieldId}`
}

/** Creates the slice holding collapsed group keys (null key = `EMPTY_GROUP_KEY`) */
export const createGroupCollapseSlice: SliceCreator<GroupCollapseSlice> = (set) => ({
  collapsedGroups: {},

  toggleGroupCollapsed: (scopeKey, key) => {
    set((state) => {
      const current = state.collapsedGroups[scopeKey] ?? []
      state.collapsedGroups[scopeKey] = current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key]
    })
  },

  setCollapsedGroups: (scopeKey, keys) => {
    set((state) => {
      state.collapsedGroups[scopeKey] = keys
    })
  },
})

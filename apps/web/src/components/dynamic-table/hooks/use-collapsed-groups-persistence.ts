// apps/web/src/components/dynamic-table/hooks/use-collapsed-groups-persistence.ts
'use client'

import type { TableViewPreferenceConfig } from '@auxx/lib/conditions/client'
import { EMPTY_GROUP_KEY } from '@auxx/lib/resources/grouping/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect } from 'react'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'
import { DYNAMIC_TABLE_CONFIG } from '../config/table-config'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import { groupCollapseScopeKey } from '../stores/group-collapse-slice'
import { useViewStoreInitialized } from '../stores/store-selectors'
import { tableViewPreferenceKey } from '../utils/constants'
import { enqueuePreferenceWrite } from '../utils/preference-write-queue'

const NO_KEYS: string[] = []

interface Scope {
  tableId: string
  viewId: string | null
  fieldId: string
}

function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a ?? [])].sort()
  const right = [...(b ?? [])].sort()
  return left.length === right.length && left.every((key, index) => key === right[index])
}

/**
 * Per-user collapsed group keys for one table/view/group field, seeded from and written to
 * the `TableViewPreference` row (plans/table/group-by-plan.md §7). Keys use `EMPTY_GROUP_KEY`
 * for the null group. Works for shared, own and unnamed views alike.
 */
export function useCollapsedGroupsPersistence({
  tableId,
  viewId,
  groupByFieldId,
}: {
  tableId: string
  viewId: string | null
  /** Undefined while the table is not grouped; the hook is then inert. */
  groupByFieldId: string | undefined
}): { collapsedKeys: string[]; toggle: (key: string | null) => void } {
  const initialized = useViewStoreInitialized()
  const scopeKey = groupByFieldId ? groupCollapseScopeKey(tableId, viewId, groupByFieldId) : null
  const preferenceKey = tableViewPreferenceKey(tableId, viewId)

  const sliceKeys = useDynamicTableStore((s) =>
    scopeKey ? s.collapsedGroups[scopeKey] : undefined
  )
  const storedKeys = useDynamicTableStore((s) =>
    groupByFieldId
      ? s.viewPreferences[preferenceKey]?.config.collapsedGroups?.[groupByFieldId]
      : undefined
  )
  const setCollapsedGroups = useDynamicTableStore((s) => s.setCollapsedGroups)
  const toggleGroupCollapsed = useDynamicTableStore((s) => s.toggleGroupCollapsed)
  const upsertViewPreference = useDynamicTableStore((s) => s.upsertViewPreference)

  // Before the slice is seeded the stored keys already apply, so the first list fetch
  // excludes collapsed groups instead of refetching once the seed lands.
  const collapsedKeys = sliceKeys ?? storedKeys ?? NO_KEYS

  useEffect(() => {
    if (!initialized || !scopeKey || sliceKeys !== undefined) return
    setCollapsedGroups(scopeKey, storedKeys ?? [])
  }, [initialized, scopeKey, sliceKeys, storedKeys, setCollapsedGroups])

  const upsertPreference = api.tableView.upsertPreference.useMutation({
    onSuccess: upsertViewPreference,
    onError: (error) => {
      toastError({ title: 'Failed to save collapsed groups', description: error.message })
    },
  })

  const persist = useCallback(
    (scope: Scope) => {
      const key = tableViewPreferenceKey(scope.tableId, scope.viewId)
      void enqueuePreferenceWrite(key, async () => {
        const state = useDynamicTableStore.getState()
        const keys =
          state.collapsedGroups[groupCollapseScopeKey(scope.tableId, scope.viewId, scope.fieldId)]
        const stored = state.viewPreferences[key]?.config
        if (!keys || sameKeys(keys, stored?.collapsedGroups?.[scope.fieldId])) return
        // The router overwrites `config` wholesale, so every other key is carried over.
        const config: TableViewPreferenceConfig = {
          ...(stored ?? { columnVisibility: {}, columnOrder: [], columnSizing: {} }),
          collapsedGroups: { ...stored?.collapsedGroups, [scope.fieldId]: keys },
        }
        await upsertPreference.mutateAsync({
          tableId: scope.tableId,
          tableViewId: scope.viewId,
          config,
        })
      })
    },
    [upsertPreference]
  )

  const debouncedPersist = useDebouncedCallback(persist, DYNAMIC_TABLE_CONFIG.AUTO_SAVE_DEBOUNCE_MS)

  useEffect(() => {
    if (!initialized || !groupByFieldId || sliceKeys === undefined) return
    if (sameKeys(sliceKeys, storedKeys)) return
    debouncedPersist({ tableId, viewId, fieldId: groupByFieldId })
  }, [initialized, groupByFieldId, sliceKeys, storedKeys, tableId, viewId, debouncedPersist])

  const toggle = useCallback(
    (key: string | null) => {
      if (!scopeKey) return
      // Seed first so a toggle before the seed effect ran never drops the stored keys.
      if (useDynamicTableStore.getState().collapsedGroups[scopeKey] === undefined) {
        setCollapsedGroups(scopeKey, storedKeys ?? [])
      }
      toggleGroupCollapsed(scopeKey, key ?? EMPTY_GROUP_KEY)
    },
    [scopeKey, storedKeys, setCollapsedGroups, toggleGroupCollapsed]
  )

  return { collapsedKeys, toggle }
}

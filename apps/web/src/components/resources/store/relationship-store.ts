// apps/web/src/components/resources/store/relationship-store.ts

import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'
import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { toRecordId, parseRecordId, type RecordId } from '@auxx/lib/resources/client'

/**
 * Zustand store for relationship field hydration
 */
export const useRelationshipStore = createHydrationStore<RecordPickerItem>({
  name: 'relationship',
  getKeyFromValue: (item) => item.recordId,
})

/**
 * Extended state type with convenience methods
 */
export interface RelationshipStoreState extends HydrationStore<RecordPickerItem> {
  /** Request hydration for RecordId[] */
  requestHydration: (recordIds: RecordId[]) => void
  /** Get items pending fetch as RecordId[] */
  getItemsToFetch: () => RecordId[]
  /** Add hydrated items. Pass requestedKeys to mark missing items as not found. */
  addHydratedItems: (items: Record<RecordId, RecordPickerItem>, requestedKeys?: RecordId[]) => void
}

/**
 * Get the relationship store state with convenience methods
 */
export function getRelationshipStoreState(): RelationshipStoreState {
  const state = useRelationshipStore.getState()

  return {
    ...state,
    requestHydration: (recordIds: RecordId[]) => {
      state.request(recordIds)
    },
    getItemsToFetch: () => {
      return state.getKeysToFetch() as RecordId[]
    },
    addHydratedItems: (items, requestedKeys) => {
      state.addItems(items, requestedKeys)
    },
  }
}

/**
 * Selector hook for getting hydrated items by RecordId
 * Returns: RecordPickerItem (found), null (not found/deleted), or undefined (not loaded)
 */
export function useHydratedItems(recordIds: RecordId[]): (RecordPickerItem | null | undefined)[] {
  const dataMap = useRelationshipStore((state) => state.dataMap)
  return useMemo(() => recordIds.map((id) => dataMap[id]), [recordIds, dataMap])
}

/**
 * Selector hook for checking if any RecordIds are loading
 */
export function useIsLoadingRelationships(recordIds: RecordId[]): boolean {
  return useRelationshipStore((state) =>
    recordIds.some((id) => state.loadingIds.has(id) || state.pendingIds.has(id))
  )
}

// Re-export utilities for convenience
export { toRecordId, parseRecordId, type RecordId }

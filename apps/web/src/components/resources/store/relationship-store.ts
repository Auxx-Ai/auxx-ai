// apps/web/src/components/resources/store/relationship-store.ts

import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'
import { toResourceId, parseResourceId, type ResourceId } from '@auxx/lib/resources/client'

/**
 * Zustand store for relationship field hydration
 */
export const useRelationshipStore = createHydrationStore<ResourcePickerItem>({
  name: 'relationship',
  getKeyFromValue: (item) => toResourceId(item.entityDefinitionId, item.id),
})

/**
 * Extended state type with convenience methods
 */
export interface RelationshipStoreState extends HydrationStore<ResourcePickerItem> {
  /** Request hydration for ResourceId[] */
  requestHydration: (resourceIds: ResourceId[]) => void
  /** Get items pending fetch as ResourceId[] */
  getItemsToFetch: () => ResourceId[]
  /** Add hydrated items. Pass requestedKeys to mark missing items as not found. */
  addHydratedItems: (items: Record<string, ResourcePickerItem>, requestedKeys?: string[]) => void
}

/**
 * Get the relationship store state with convenience methods
 */
export function getRelationshipStoreState(): RelationshipStoreState {
  const state = useRelationshipStore.getState()

  return {
    ...state,
    requestHydration: (resourceIds: ResourceId[]) => {
      state.request(resourceIds)
    },
    getItemsToFetch: () => {
      return state.getKeysToFetch() as ResourceId[]
    },
    addHydratedItems: (items, requestedKeys) => {
      state.addItems(items, requestedKeys)
    },
  }
}

/**
 * Selector hook for getting hydrated items by ResourceId
 * Returns: ResourcePickerItem (found), null (not found/deleted), or undefined (not loaded)
 */
export function useHydratedItems(resourceIds: ResourceId[]): (ResourcePickerItem | null | undefined)[] {
  const dataMap = useRelationshipStore((state) => state.dataMap)
  return useMemo(() => resourceIds.map((id) => dataMap[id]), [resourceIds, dataMap])
}

/**
 * Selector hook for checking if any ResourceIds are loading
 */
export function useIsLoadingRelationships(resourceIds: ResourceId[]): boolean {
  return useRelationshipStore((state) =>
    resourceIds.some((id) => state.loadingIds.has(id) || state.pendingIds.has(id))
  )
}

// Re-export utilities for convenience
export { toResourceId, parseResourceId, type ResourceId }

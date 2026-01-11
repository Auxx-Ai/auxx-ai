// apps/web/src/components/resources/store/relationship-store.ts

import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'

/**
 * Build a relationship cache key from resourceId and id
 */
export function buildRelationshipKey(resourceId: string, id: string): string {
  return `${resourceId}:${id}`
}

/**
 * Parse a relationship cache key into resourceId and id
 * Expected format: "resourceId:id"
 */
export function parseRelationshipKey(key: string): { resourceId: string; id: string } {
  const colonIndex = key.indexOf(':')
  if (colonIndex === -1) {
    console.error('[RelationshipStore] Malformed key (missing colon):', key)
    return { resourceId: key, id: '' }
  }
  const resourceId = key.slice(0, colonIndex)
  const id = key.slice(colonIndex + 1)
  return { resourceId, id }
}

/**
 * Zustand store for relationship field hydration
 */
export const useRelationshipStore = createHydrationStore<ResourcePickerItem>({
  name: 'relationship',
  getKeyFromValue: (item) => buildRelationshipKey(item.entityDefinitionId, item.id),
})

/**
 * Extended state type with convenience methods
 */
export interface RelationshipStoreState extends HydrationStore<ResourcePickerItem> {
  requestHydration: (items: Array<{ resourceId: string; id: string }>) => void
  getItemsToFetch: () => Array<{ resourceId: string; id: string }>
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
    requestHydration: (items) => {
      const keys = items.map(({ resourceId, id }) => buildRelationshipKey(resourceId, id))
      state.request(keys)
    },
    getItemsToFetch: () => {
      return state.getKeysToFetch().map(parseRelationshipKey)
    },
    addHydratedItems: (items, requestedKeys) => {
      state.addItems(items, requestedKeys)
    },
  }
}

/**
 * Selector hook for getting hydrated items by keys
 * Returns: ResourcePickerItem (found), null (not found/deleted), or undefined (not loaded)
 */
export function useHydratedItems(keys: string[]): (ResourcePickerItem | null | undefined)[] {
  const dataMap = useRelationshipStore((state) => state.dataMap)
  return useMemo(() => keys.map((key) => dataMap[key]), [keys, dataMap])
}

/**
 * Selector hook for checking if any keys are loading
 */
export function useIsLoadingRelationships(keys: string[]): boolean {
  return useRelationshipStore((state) =>
    keys.some((key) => state.loadingIds.has(key) || state.pendingIds.has(key))
  )
}

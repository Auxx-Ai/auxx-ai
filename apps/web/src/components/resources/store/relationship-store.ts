// apps/web/src/components/resources/store/relationship-store.ts

import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'
import type { ResourceRef } from '@auxx/types/resource'

/**
 * Build a relationship cache key from ResourceRef
 */
export function buildRelationshipKey(ref: ResourceRef): string
export function buildRelationshipKey(entityDefinitionId: string, entityInstanceId: string): string
export function buildRelationshipKey(
  refOrEntityDefinitionId: ResourceRef | string,
  entityInstanceId?: string
): string {
  if (typeof refOrEntityDefinitionId === 'object') {
    return `${refOrEntityDefinitionId.entityDefinitionId}:${refOrEntityDefinitionId.entityInstanceId}`
  }
  return `${refOrEntityDefinitionId}:${entityInstanceId}`
}

/**
 * Parse a relationship cache key into ResourceRef
 * Expected format: "entityDefinitionId:entityInstanceId"
 */
export function parseRelationshipKey(key: string): ResourceRef {
  const colonIndex = key.indexOf(':')
  if (colonIndex === -1) {
    console.error('[RelationshipStore] Malformed key (missing colon):', key)
    return { entityDefinitionId: key, entityInstanceId: '' }
  }
  return {
    entityDefinitionId: key.slice(0, colonIndex),
    entityInstanceId: key.slice(colonIndex + 1),
  }
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
  /** Request hydration for ResourceRef[] */
  requestHydration: (refs: ResourceRef[]) => void
  /** Get items pending fetch as ResourceRef[] */
  getItemsToFetch: () => ResourceRef[]
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
    requestHydration: (refs: ResourceRef[]) => {
      const keys = refs.map(buildRelationshipKey)
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

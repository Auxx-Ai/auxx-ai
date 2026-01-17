// apps/web/src/components/resources/hooks/use-relationship.ts

import { useEffect, useMemo } from 'react'
import { useHydratedItems, useIsLoadingRelationships, getRelationshipStoreState } from '../store'
import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { getInstanceId, type ResourceId } from '@auxx/lib/resources/client'

interface UseRelationshipResult {
  /** Hydrated items indexed by position (matches input resourceIds order) */
  items: (RecordPickerItem | null | undefined)[]
  /** Map of entityInstanceId -> RecordPickerItem for random access */
  itemsMap: Map<string, RecordPickerItem | null | undefined>
  /** Whether any items are still loading */
  isLoading: boolean
  /** Whether all items are resolved (found or not found) */
  isComplete: boolean
}

/**
 * Hook for requesting and subscribing to relationship items
 *
 * @param resourceIds - Array of ResourceId to hydrate (supports mixed entity types)
 * @returns Hydrated items and loading state
 *
 * @example
 * const resourceIds = extractRelationshipResourceIds(fieldValue)
 * const { items, isLoading } = useRelationship(resourceIds)
 */
export function useRelationship(resourceIds: ResourceId[]): UseRelationshipResult {

  // Create stable key for effect dependency
  const resourceIdsKey = useMemo(() => resourceIds.join('|'), [resourceIds])

  // Request hydration on mount/change
  useEffect(() => {
    if (resourceIds.length === 0) return
    getRelationshipStoreState().requestHydration(resourceIds)
  }, [resourceIdsKey, resourceIds])

  // Subscribe to hydrated items
  const items = useHydratedItems(resourceIds)
  const isLoading = useIsLoadingRelationships(resourceIds)
  const isComplete = resourceIds.length > 0 && items.every((item) => item !== undefined)

  // Build itemsMap for random access (keyed by entityInstanceId)
  const itemsMap = useMemo(() => {
    const map = new Map<string, RecordPickerItem | null | undefined>()
    resourceIds.forEach((resourceId, idx) => {
      map.set(getInstanceId(resourceId), items[idx])
    })
    return map
  }, [resourceIds, items])

  return { items, itemsMap, isLoading, isComplete }
}

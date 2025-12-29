// apps/web/src/components/resources/hooks/use-relationship.ts

import { useEffect, useMemo } from 'react'
import { useResourceProvider } from '../providers/resource-provider'
import { useHydratedItems, useIsLoadingRelationships, buildRelationshipKey } from '../store'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'

interface UseRelationshipResult {
  /** Hydrated items: ResourcePickerItem (found), null (deleted/not found), undefined (loading) */
  items: (ResourcePickerItem | null | undefined)[]
  /** Whether any items are still loading */
  isLoading: boolean
  /** Whether all items are resolved (found or not found) */
  isComplete: boolean
}

/**
 * Hook for requesting and subscribing to relationship items
 * Uses selector-based subscriptions to only re-render when specific data changes
 *
 * @param resourceId - The resource type (e.g., 'contact', 'entity_vendors')
 * @param ids - Array of IDs to hydrate
 * @returns Hydrated items and loading state
 */
export function useRelationship(resourceId: string | null, ids: string[]): UseRelationshipResult {
  const { requestRelationshipHydration } = useResourceProvider()

  const keys = useMemo(() => {
    if (!resourceId || ids.length === 0) return []
    return ids.map((id) => buildRelationshipKey(resourceId, id))
  }, [resourceId, ids])

  const idsKey = ids.join(',')

  useEffect(() => {
    if (!resourceId || ids.length === 0) return
    requestRelationshipHydration(ids.map((id) => ({ resourceId, id })))
  }, [resourceId, idsKey, requestRelationshipHydration])

  const items = useHydratedItems(keys)
  const isLoading = useIsLoadingRelationships(keys)
  const isComplete = keys.length > 0 && items.every((item) => item !== undefined)

  return { items, isLoading, isComplete }
}

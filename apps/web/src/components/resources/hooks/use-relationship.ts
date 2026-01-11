// apps/web/src/components/resources/hooks/use-relationship.ts

import { useEffect, useMemo } from 'react'
import { useResourceProvider } from '../providers/resource-provider'
import { useHydratedItems, useIsLoadingRelationships, buildRelationshipKey } from '../store'
import type { ResourcePickerItem } from '@auxx/lib/resources/client'
import type { ResourceRef } from '@auxx/types/resource'

interface UseRelationshipResult {
  /** Hydrated items indexed by position (matches input refs order) */
  items: (ResourcePickerItem | null | undefined)[]
  /** Map of entityInstanceId -> ResourcePickerItem for random access */
  itemsMap: Map<string, ResourcePickerItem | null | undefined>
  /** Whether any items are still loading */
  isLoading: boolean
  /** Whether all items are resolved (found or not found) */
  isComplete: boolean
}

/**
 * Hook for requesting and subscribing to relationship items
 *
 * @param refs - Array of ResourceRef to hydrate (supports mixed entity types)
 * @returns Hydrated items and loading state
 *
 * @example
 * const refs = extractRelationshipRefs(fieldValue)
 * const { items, isLoading } = useRelationship(refs)
 */
export function useRelationship(refs: ResourceRef[]): UseRelationshipResult {
  const { requestRelationshipHydration } = useResourceProvider()

  // Build cache keys
  const keys = useMemo(() => {
    if (refs.length === 0) return []
    return refs.map(buildRelationshipKey)
  }, [refs])

  // Create stable reference key for effect dependency
  const refsKey = useMemo(() => {
    return refs.map((r) => `${r.entityDefinitionId}:${r.entityInstanceId}`).join('|')
  }, [refs])

  // Request hydration on mount/change
  useEffect(() => {
    if (refs.length === 0) return
    requestRelationshipHydration(refs)
  }, [refsKey, requestRelationshipHydration])

  // Subscribe to hydrated items
  const items = useHydratedItems(keys)
  const isLoading = useIsLoadingRelationships(keys)
  const isComplete = keys.length > 0 && items.every((item) => item !== undefined)

  // Build itemsMap for random access
  const itemsMap = useMemo(() => {
    const map = new Map<string, ResourcePickerItem | null | undefined>()
    refs.forEach((ref, idx) => {
      map.set(ref.entityInstanceId, items[idx])
    })
    return map
  }, [refs, items])

  return { items, itemsMap, isLoading, isComplete }
}

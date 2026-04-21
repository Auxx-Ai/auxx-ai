// apps/web/src/components/resources/hooks/use-relationship.ts

import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { getInstanceId, type RecordId } from '@auxx/lib/resources/client'
import { useEffect, useMemo } from 'react'
import { getRelationshipStoreState, useHydratedItems, useIsLoadingRelationships } from '../store'
import { useNormalizedRecordIds } from '../utils/normalize-record-id'

interface UseRelationshipResult {
  /** Hydrated items indexed by position (matches input recordIds order) */
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
 * @param recordIds - Array of RecordId to hydrate (supports mixed entity types)
 * @returns Hydrated items and loading state
 *
 * @example
 * const recordIds = extractRelationshipRecordIds(fieldValue)
 * const { items, isLoading } = useRelationship(recordIds)
 */
export function useRelationship(recordIds: RecordId[]): UseRelationshipResult {
  // Canonicalize prefixes so `contact:<id>` and `<UUID>:<id>` map to the same
  // hydration slot and request key. Returns the input unchanged when every id
  // is already canonical, so memoization downstream is not disturbed.
  const normalizedRecordIds = useNormalizedRecordIds(recordIds)

  // Request hydration on mount/change
  useEffect(() => {
    if (normalizedRecordIds.length === 0) return
    getRelationshipStoreState().requestHydration(normalizedRecordIds)
  }, [normalizedRecordIds])

  // Subscribe to hydrated items
  const items = useHydratedItems(normalizedRecordIds)
  const isLoading = useIsLoadingRelationships(normalizedRecordIds)
  const isComplete = normalizedRecordIds.length > 0 && items.every((item) => item !== undefined)

  // Build itemsMap for random access (keyed by entityInstanceId)
  const itemsMap = useMemo(() => {
    const map = new Map<string, RecordPickerItem | null | undefined>()
    normalizedRecordIds.forEach((recordId, idx) => {
      map.set(getInstanceId(recordId), items[idx])
    })
    return map
  }, [normalizedRecordIds, items])

  return { items, itemsMap, isLoading, isComplete }
}

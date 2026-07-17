// apps/web/src/components/resources/store/relationship-store.ts

import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { createHydrationStore, type HydrationStore } from '~/stores'
import {
  getNormalizedRecordId,
  tryNormalizeRecordId,
  useNormalizedRecordIds,
} from '../utils/normalize-record-id'

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
  /**
   * Drain up to `max` canonicalizable pending ids into loadingIds and return
   * the canonical batch. Alias + canonical duplicates collapse into one slot;
   * unresolved prefixes stay pending until the prefix map changes.
   */
  startBatch: (max: number) => RecordId[]
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
      // Canonicalize — dataMap is keyed by the requested RecordId verbatim
      // (server echoes the caller's prefix), so alias requests would create
      // slots no post-hydration reader watches. Pre-hydration aliases queue
      // as-is and are canonicalized at drain time in startBatch().
      state.request(recordIds.map(getNormalizedRecordId))
    },
    startBatch: (max: number) => {
      // Mirror the record-store drain: normalize each queued id once, select
      // unique canonical ids up to `max`, drain every queued form mapping to
      // a selected id, leave unresolved ids pending.
      const canonicalByQueued = new Map<string, RecordId | null>()
      for (const queuedId of state.pendingIds) {
        canonicalByQueued.set(queuedId, tryNormalizeRecordId(queuedId as RecordId))
      }

      const recordIds: RecordId[] = []
      const selected = new Set<RecordId>()
      for (const canonicalId of canonicalByQueued.values()) {
        if (!canonicalId || selected.has(canonicalId)) continue
        if (recordIds.length >= max) break
        selected.add(canonicalId)
        recordIds.push(canonicalId)
      }
      if (recordIds.length === 0) return []

      const drained: string[] = []
      for (const [queuedId, canonicalId] of canonicalByQueued) {
        if (canonicalId && selected.has(canonicalId)) drained.push(queuedId)
      }
      state.drainToLoading(drained, recordIds)

      return recordIds
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
export function useHydratedItems(
  rawRecordIds: RecordId[]
): (RecordPickerItem | null | undefined)[] {
  const recordIds = useNormalizedRecordIds(rawRecordIds)
  const dataMap = useRelationshipStore((state) => state.dataMap)
  return useMemo(() => recordIds.map((id) => dataMap[id]), [recordIds, dataMap])
}

/**
 * Selector hook for checking if any RecordIds are loading
 */
export function useIsLoadingRelationships(rawRecordIds: RecordId[]): boolean {
  const recordIds = useNormalizedRecordIds(rawRecordIds)
  return useRelationshipStore((state) =>
    recordIds.some((id) => state.loadingIds.has(id) || state.pendingIds.has(id))
  )
}

// Re-export utilities for convenience
export { toRecordId, parseRecordId, type RecordId }

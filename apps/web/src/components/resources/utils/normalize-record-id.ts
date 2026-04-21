// apps/web/src/components/resources/utils/normalize-record-id.ts

'use client'

import { parseRecordId, type RecordId, type Resource, toRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResourceStore } from '../store/resource-store'

/**
 * Normalize a RecordId so the definition prefix is always the real
 * `entityDefinitionId` (the EntityDefinition row id), never the entityType
 * string or apiSlug.
 *
 * Callers can produce RecordIds in a few shapes — e.g. `toRecordId('ticket', id)`
 * yields `"ticket:<instanceId>"`, while server writes/reads key by the actual
 * EntityDefinition id. Field-value store keys include the prefix verbatim, so
 * a mismatch here causes subscriptions to miss optimistic updates.
 */
export function normalizeRecordId(recordId: RecordId, resource: Resource): RecordId {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!entityInstanceId) return recordId
  if (resource.entityDefinitionId === entityDefinitionId) return recordId
  return toRecordId(resource.entityDefinitionId, entityInstanceId)
}

/**
 * Hook variant of {@link normalizeRecordId} that resolves the resource from the
 * resource store. Falls back to the input when the resource is unknown.
 *
 * Subscribes only to `hasLoadedOnce` (a single-flip boolean) rather than the
 * whole `resourceMap`, then reads the map imperatively. This keeps
 * subscription fan-out minimal on pages with hundreds of badges — zustand
 * skips notifications when `hasLoadedOnce` stays `true`, so mid-session
 * `setResources` calls (optimistic resource updates, new fields arriving, …)
 * do not re-render every consumer.
 */
export function useNormalizedRecordId(
  recordId: RecordId | null | undefined
): RecordId | null | undefined {
  const hasLoaded = useResourceStore((s) => s.hasLoadedOnce)

  return useMemo(() => {
    if (!recordId) return recordId
    if (!hasLoaded) return recordId
    return getNormalizedRecordId(recordId)
  }, [recordId, hasLoaded])
}

/**
 * Plural variant of {@link useNormalizedRecordId}. Maps each id through the
 * same imperative lookup. Returns the input array unchanged when resources
 * haven't loaded yet.
 */
export function useNormalizedRecordIds(recordIds: RecordId[]): RecordId[] {
  const hasLoaded = useResourceStore((s) => s.hasLoadedOnce)

  return useMemo(() => {
    if (!hasLoaded) return recordIds
    let changed = false
    const normalized = recordIds.map((rid) => {
      const next = getNormalizedRecordId(rid)
      if (next !== rid) changed = true
      return next
    })
    return changed ? normalized : recordIds
  }, [recordIds, hasLoaded])
}

/**
 * Imperative variant — reads the current resource store state directly.
 * Use from non-hook contexts (mutation callbacks, fetch queue, etc.).
 */
export function getNormalizedRecordId(recordId: RecordId): RecordId {
  const { entityDefinitionId } = parseRecordId(recordId)
  if (!entityDefinitionId) return recordId
  const resource = useResourceStore.getState().resourceMap.get(entityDefinitionId)
  if (!resource) return recordId
  return normalizeRecordId(recordId, resource)
}

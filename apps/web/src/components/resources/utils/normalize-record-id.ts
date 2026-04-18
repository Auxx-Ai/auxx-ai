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
 */
export function useNormalizedRecordId(
  recordId: RecordId | null | undefined
): RecordId | null | undefined {
  const resourceMap = useResourceStore((s) => s.resourceMap)

  return useMemo(() => {
    if (!recordId) return recordId
    const { entityDefinitionId } = parseRecordId(recordId)
    if (!entityDefinitionId) return recordId
    const resource = resourceMap.get(entityDefinitionId)
    if (!resource) return recordId
    return normalizeRecordId(recordId, resource)
  }, [recordId, resourceMap])
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

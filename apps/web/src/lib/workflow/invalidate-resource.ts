// apps/web/src/lib/workflow/invalidate-resource.ts

import { getModelType, parseRecordId, type RecordId } from '@auxx/types/resource'
import { getQueryKey } from '@trpc/react-query'
import { api, getQueryClient } from '~/trpc/react'

/**
 * Internal type for cache invalidation (derived from entityDefinitionId via getModelType)
 */
type InvalidationType = 'thread' | 'contact' | 'ticket' | 'message' | 'entity'

/**
 * Derives the invalidation type from entityDefinitionId.
 * System types (thread, message, contact, ticket) are returned as-is.
 * Custom entities return 'entity'.
 */
function getInvalidationType(entityDefinitionId: string): InvalidationType {
  const modelType = getModelType(entityDefinitionId)
  if (['thread', 'message', 'contact', 'ticket'].includes(modelType)) {
    return modelType as InvalidationType
  }
  return 'entity'
}

/**
 * Invalidates React Query cache for a specific resource after workflow completion
 *
 * @param recordId - Full RecordId in format "entityDefinitionId:entityInstanceId"
 */
export function invalidateResource(recordId: RecordId) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const invalidationType = getInvalidationType(entityDefinitionId)
  const queryClient = getQueryClient()

  switch (invalidationType) {
    case 'thread':
    case 'message':
      // With optimistic store updates, thread lists don't need invalidation.
      // The store is the source of truth and updates are already applied.
      // Only invalidate getCounts (workflow may have changed status).
      // queryClient.invalidateQueries({
      //   queryKey: getQueryKey(api.thread.getCounts),
      //   exact: false,
      // })
      break

    case 'contact':
      // Invalidate specific contact
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.contact.getById, { id: entityInstanceId }, 'query'),
      })
      // Invalidate contact lists
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.contact.getAll),
        exact: false,
      })
      break

    case 'ticket':
      // Invalidate specific ticket
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.ticket.byId, { id: entityInstanceId }, 'query'),
      })
      // Invalidate ticket lists
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.ticket.list),
        exact: false,
      })
      // Invalidate record.search for picker dialogs
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.search),
        exact: false,
      })
      break

    case 'entity':
      // Invalidate specific entity instance via record router
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.getById, { recordId }, 'query'),
      })
      // Invalidate listFiltered for the entity type
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.listFiltered),
        exact: false,
      })
      // Invalidate record.search for picker dialogs
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.search),
        exact: false,
      })
      break
  }
}

/**
 * Creates an onComplete callback for workflow tracking that invalidates the resource
 */
export function createWorkflowInvalidator(recordId: RecordId) {
  return () => invalidateResource(recordId)
}

/**
 * Invalidates React Query cache for multiple resources after batch workflow completion
 * Optimized to only invalidate list/count queries once instead of per-resource
 *
 * @param recordIds - Array of RecordIds in format "entityDefinitionId:entityInstanceId"
 */
export function invalidateBatchResources(recordIds: RecordId[]) {
  if (recordIds.length === 0) return

  // Parse first recordId to get entityDefinitionId (all should be same type in batch)
  const { entityDefinitionId } = parseRecordId(recordIds[0]!)
  const invalidationType = getInvalidationType(entityDefinitionId)

  console.log('[invalidateBatchResources] Invalidating batch', {
    invalidationType,
    entityDefinitionId,
    count: recordIds.length,
  })
  const queryClient = getQueryClient()

  // Parse all recordIds to get entityInstanceIds
  const entityInstanceIds = recordIds.map((r) => parseRecordId(r).entityInstanceId)

  switch (invalidationType) {
    case 'thread':
    case 'message':
      // With optimistic store updates, thread lists don't need invalidation.
      // The store is the source of truth and updates are already applied.
      // Only invalidate getCounts (workflow may have changed status).
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.getCounts),
        exact: false,
      })
      break

    case 'contact':
      entityInstanceIds.forEach((entityInstanceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.contact.getById, { id: entityInstanceId }, 'query'),
        })
      })
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.contact.getAll),
        exact: false,
      })
      break

    case 'ticket':
      entityInstanceIds.forEach((entityInstanceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.ticket.byId, { id: entityInstanceId }, 'query'),
        })
      })
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.ticket.list),
        exact: false,
      })
      // Invalidate record.search for picker dialogs
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.search),
        exact: false,
      })
      break

    case 'entity':
      // Invalidate each specific entity instance via record router
      recordIds.forEach((recordId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.record.getById, { recordId }, 'query'),
        })
      })
      // Invalidate listFiltered for the entity type ONCE
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.listFiltered),
        exact: false,
      })
      // Invalidate record.search for picker dialogs
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.record.search),
        exact: false,
      })
      break
  }
}

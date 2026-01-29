// apps/web/src/lib/workflow/invalidate-resource.ts

import { getQueryKey } from '@trpc/react-query'
import { getQueryClient, api } from '~/trpc/react'
import { type RecordId, parseRecordId, getModelType } from '@auxx/types/resource'

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
      // Invalidate specific thread
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.getById, { threadId: entityInstanceId }, 'query'),
      })
      // Invalidate thread lists (will refetch with updated data)
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.list),
        exact: false,
      })
      // Invalidate counts (status may have changed)
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.getCounts),
        exact: false,
      })
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
      // Invalidate each specific thread
      entityInstanceIds.forEach((entityInstanceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.thread.getById, { threadId: entityInstanceId }, 'query'),
        })
      })
      // Invalidate list and counts ONCE
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.list),
        exact: false,
      })
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

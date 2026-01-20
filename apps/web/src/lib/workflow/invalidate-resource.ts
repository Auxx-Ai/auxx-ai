// apps/web/src/lib/workflow/invalidate-resource.ts

import { getQueryKey } from '@trpc/react-query'
import { getQueryClient, api } from '~/trpc/react'
import { toRecordId } from '@auxx/lib/resources/client'

export type ResourceType = 'thread' | 'contact' | 'ticket' | 'message' | 'entity'

/**
 * Invalidates React Query cache for a specific resource after workflow completion
 *
 * @param resourceType - Type of resource to invalidate
 * @param resourceId - ID of the specific resource instance
 * @param entityDefinitionId - Entity definition ID (required when resourceType is 'entity')
 */
export function invalidateResource(
  resourceType: ResourceType,
  resourceId: string,
  entityDefinitionId?: string
) {
  const queryClient = getQueryClient()

  switch (resourceType) {
    case 'thread':
    case 'message':
      // Invalidate specific thread
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.thread.getById, { threadId: resourceId }, 'query'),
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
        queryKey: getQueryKey(api.contact.getById, { id: resourceId }, 'query'),
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
        queryKey: getQueryKey(api.ticket.byId, { id: resourceId }, 'query'),
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
      if (entityDefinitionId) {
        const recordId = toRecordId(entityDefinitionId, resourceId)
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.record.getById, { recordId }, 'query'),
        })
      }
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
export function createWorkflowInvalidator(
  resourceType: ResourceType,
  resourceId: string,
  entityDefinitionId?: string
) {
  return () => invalidateResource(resourceType, resourceId, entityDefinitionId)
}

/**
 * Invalidates React Query cache for multiple resources after batch workflow completion
 * Optimized to only invalidate list/count queries once instead of per-resource
 *
 * @param resourceType - Type of resources to invalidate
 * @param resourceIds - IDs of the specific resource instances
 * @param entityDefinitionId - Entity definition ID (required when resourceType is 'entity')
 */
export function invalidateBatchResources(
  resourceType: ResourceType,
  resourceIds: string[],
  entityDefinitionId?: string
) {
  if (resourceIds.length === 0) return

  console.log('[invalidateBatchResources] Invalidating batch', {
    resourceType,
    count: resourceIds.length,
  })
  const queryClient = getQueryClient()

  switch (resourceType) {
    case 'thread':
    case 'message':
      // Invalidate each specific thread
      resourceIds.forEach((resourceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.thread.getById, { threadId: resourceId }, 'query'),
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
      resourceIds.forEach((resourceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.contact.getById, { id: resourceId }, 'query'),
        })
      })
      queryClient.invalidateQueries({
        queryKey: getQueryKey(api.contact.getAll),
        exact: false,
      })
      break

    case 'ticket':
      resourceIds.forEach((resourceId) => {
        queryClient.invalidateQueries({
          queryKey: getQueryKey(api.ticket.byId, { id: resourceId }, 'query'),
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
      if (entityDefinitionId) {
        resourceIds.forEach((resourceId) => {
          const recordId = toRecordId(entityDefinitionId, resourceId)
          queryClient.invalidateQueries({
            queryKey: getQueryKey(api.record.getById, { recordId }, 'query'),
          })
        })
      }
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

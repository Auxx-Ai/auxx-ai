// apps/web/src/hooks/use-optimistic-mutation.tsx

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'
import { UnifiedCacheManager, CacheTransaction } from '~/lib/cache'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

/**
 * Configuration for optimistic mutations
 */
export interface OptimisticConfig<TData, TVariables> {
  /**
   * Type of entity being mutated
   */
  entityType: 'thread' | 'message' | 'contact' | 'order'

  /**
   * Name of the mutation for error messages
   */
  mutationName: string

  /**
   * Extract entity ID(s) from mutation variables
   */
  getEntityId?: (variables: TVariables) => string
  getEntityIds?: (variables: TVariables) => string[]

  /**
   * Generate optimistic data from variables
   */
  getOptimisticData: (variables: TVariables) => any

  /**
   * Whether this mutation moves entities between lists
   */
  movesBetweenLists?: boolean

  /**
   * Define list movements for cross-list mutations
   */
  getListMovement?: (variables: TVariables) => {
    from: { statusSlug?: string | string[]; contextType?: string; contextId?: string }
    to: { statusSlug?: string | string[]; contextType?: string; contextId?: string }
  }

  /**
   * Side effects to execute
   */
  sideEffects?: Array<'updateUnreadCount' | 'updateThreadCounts' | 'invalidateDetails'>

  /**
   * Custom success handler
   */
  onSuccess?: (data: TData, variables: TVariables) => void

  /**
   * Custom error handler
   */
  onError?: (error: Error, variables: TVariables) => void

  /**
   * Custom settled handler
   */
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void
}

/**
 * Main optimistic mutation hook
 * Wraps any tRPC mutation with intelligent cache management
 */
export function useOptimisticMutation<TData, TVariables>(
  mutation: UseMutationOptions<TData, Error, TVariables>,
  config: OptimisticConfig<TData, TVariables>
) {
  const queryClient = useQueryClient()
  const cacheManager = new UnifiedCacheManager(queryClient, config.entityType)

  return useMutation({
    ...mutation,
    onMutate: async (variables) => {
      try {
        // Create transaction for automatic rollback
        const transaction = new CacheTransaction(queryClient)

        await transaction.execute(async () => {
          // Cancel related queries to prevent race conditions
          await cancelRelatedQueries(config.entityType, queryClient)

          // Get optimistic updates from config
          const updates = config.getOptimisticData(variables)

          // Handle single or multiple entities
          const entityIds = config.getEntityIds
            ? config.getEntityIds(variables)
            : config.getEntityId
              ? [config.getEntityId(variables)]
              : []

          // Apply optimistic updates
          entityIds.forEach((entityId) => {
            if (config.movesBetweenLists && config.getListMovement) {
              // Handle cross-list movements
              const movement = config.getListMovement(variables)
              cacheManager.moveEntityBetweenQueries(entityId, updates, movement.from, movement.to)
            } else {
              // Simple in-place update
              cacheManager.updateEntityInAllQueries(entityId, updates)
            }
          })

          // Execute side effects
          if (config.sideEffects) {
            await executeSideEffects(config.sideEffects, variables, queryClient)
          }
        })

        return { transaction }
      } catch (error) {
        console.error(`Error in optimistic update for ${config.mutationName}:`, error)
        // Return undefined context to skip rollback since transaction handles it
        return undefined
      }
    },

    onError: (err, variables, context) => {
      // Transaction automatically handles rollback

      // Use custom error handler or default
      if (config.onError) {
        config.onError(err, variables)
      } else {
        toastError({ title: `Failed to ${config.mutationName}`, description: err.message })
      }
    },

    onSuccess: (data, variables) => {
      // Handle server response
      if (config.onSuccess) {
        config.onSuccess(data, variables)
      }

      // Optionally update cache with server data
      // This overwrites optimistic updates with server truth
      updateCacheWithServerData(data, variables, config, cacheManager)
    },

    onSettled: (data, error, variables) => {
      if (config.onSettled) {
        config.onSettled(data, error, variables)
      }

      // Optional: Light invalidation for critical queries only
      // This ensures eventual consistency without full refetches
      if (config.sideEffects?.includes('invalidateDetails')) {
        const entityIds = config.getEntityIds
          ? config.getEntityIds(variables)
          : config.getEntityId
            ? [config.getEntityId(variables)]
            : []

        entityIds.forEach((entityId) => {
          queryClient.invalidateQueries({
            queryKey: [config.entityType, 'getById', { id: entityId }],
          })
        })
      }
    },
  })
}

/**
 * Cancel related queries to prevent race conditions
 */
async function cancelRelatedQueries(
  entityType: string,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await queryClient.cancelQueries({
    predicate: (query) => {
      const key = query.queryKey[0]
      return Array.isArray(key) && key[0] === entityType
    },
  })
}

/**
 * Execute side effects based on configuration
 */
async function executeSideEffects(
  sideEffects: string[],
  variables: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  for (const effect of sideEffects) {
    try {
      switch (effect) {
        case 'updateUnreadCount':
          await updateUnreadCounts(variables, queryClient)
          break
        case 'updateThreadCounts':
          await updateThreadCounts(variables, queryClient)
          break
        case 'invalidateDetails':
          // Handled in onSettled
          break
        default:
          console.warn(`Unknown side effect: ${effect}`)
      }
    } catch (error) {
      console.error(`Error executing side effect ${effect}:`, error)
    }
  }
}

/**
 * Update unread counts optimistically
 */
async function updateUnreadCounts(
  variables: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  // Get current thread data to determine count changes
  const threadIds = variables.threadIds || [variables.threadId]

  // For now, just invalidate counts - we can optimize this later
  await queryClient.invalidateQueries({ queryKey: ['thread', 'getCounts'] })
}

/**
 * Update thread counts optimistically
 */
async function updateThreadCounts(
  variables: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  // Invalidate count-related queries
  await queryClient.invalidateQueries({ queryKey: ['thread', 'getCounts'] })
}

/**
 * Update cache with server response data
 */
function updateCacheWithServerData<TData, TVariables>(
  data: TData,
  variables: TVariables,
  config: OptimisticConfig<TData, TVariables>,
  cacheManager: UnifiedCacheManager<any>
): void {
  // If server returns updated entities, merge them into cache
  if (data && typeof data === 'object') {
    const serverData = data as any

    // Handle single entity response
    if (serverData.id && config.getEntityId) {
      const entityId = config.getEntityId(variables)
      cacheManager.updateEntityInAllQueries(entityId, serverData)
    }

    // Handle bulk operation response
    if (serverData.updatedThreads && Array.isArray(serverData.updatedThreads)) {
      serverData.updatedThreads.forEach((entity: any) => {
        cacheManager.updateEntityInAllQueries(entity.id, entity)
      })
    }
  }
}

/**
 * Default error handler
 */
export function defaultErrorHandler(error: Error, mutationName: string): void {
  toastError({ title: `Failed to ${mutationName}`, description: error.message })
}

/**
 * Default success handler
 */
export function defaultSuccessHandler(mutationName: string): void {
  toastSuccess({ description: `Successfully ${mutationName}` })
}

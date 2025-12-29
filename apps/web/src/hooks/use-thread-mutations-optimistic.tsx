// apps/web/src/hooks/use-thread-mutations-optimistic.tsx

import { type UseMutationResult } from '@tanstack/react-query'
import { api } from '~/trpc/react'
import { useOptimisticMutation, type OptimisticConfig } from './use-optimistic-mutation'
import { threadMutationConfigs, type ThreadMutationConfig } from '~/lib/cache'
import { toastSuccess } from '@auxx/ui/components/toast'

/**
 * Type-safe mutation factory for thread operations
 * Creates optimistic mutations with declarative configuration
 */
export function createThreadMutation<TVariables>(
  mutationKey: keyof typeof api.thread,
  config: ThreadMutationConfig<TVariables>
) {
  return (): UseMutationResult<any, Error, TVariables> => {
    // Get the base tRPC mutation function (not the result)
    const baseMutationFn = (api.thread as any)[mutationKey]

    // Convert thread config to optimistic config
    const optimisticConfig: OptimisticConfig<any, TVariables> = {
      entityType: 'thread',
      mutationName: mutationKey as string,
      getOptimisticData: config.getOptimisticData,
      movesBetweenLists: config.movesBetweenLists,
      getListMovement: config.getListMovement,
      sideEffects: config.sideEffects,
      onSuccess: config.onSuccess,
      onError: config.onError,

      // Auto-generate entity ID extraction
      getEntityId: (vars: any) => {
        if (vars.threadId) return vars.threadId
        if (vars.id) return vars.id
        return undefined
      },

      getEntityIds: (vars: any) => {
        if (vars.threadIds) return vars.threadIds
        if (vars.threadId) return [vars.threadId]
        if (vars.id) return [vars.id]
        return []
      },
    }

    // Create mutation options object that useOptimisticMutation expects
    const mutationOptions = {
      mutationFn: baseMutationFn.mutate,
      // Other options can be added here if needed
    }

    return useOptimisticMutation(mutationOptions, optimisticConfig)
  }
}

/**
 * Main hook providing all optimistic thread mutations
 * Replaces the existing useThreadMutations hook
 */
export function useThreadMutationsOptimistic() {
  // Create optimistic mutations using the factory and predefined configs
  const archiveThread = createThreadMutation('archive', {
    ...threadMutationConfigs.archive,
    onSuccess: () => toastSuccess({ title: 'Thread archived' }),
  })()

  const unarchiveThread = createThreadMutation('unarchive', {
    ...threadMutationConfigs.unarchive,
    onSuccess: () => toastSuccess({ title: 'Thread restored' }),
  })()

  const moveToTrash = createThreadMutation('moveToTrash', {
    ...threadMutationConfigs.moveToTrash,
    onSuccess: () => toastSuccess({ title: 'Thread moved to trash' }),
  })()

  const restoreFromTrash = createThreadMutation('restoreFromTrash', {
    ...threadMutationConfigs.restoreFromTrash,
    onSuccess: () => toastSuccess({ title: 'Thread restored from trash' }),
  })()

  const moveToTrashBulk = createThreadMutation('moveToTrashBulk', {
    ...threadMutationConfigs.moveToTrashBulk,
    onSuccess: (data, vars) => {
      const count = vars.threadIds.length
      toastSuccess({ title: `${count} thread${count === 1 ? '' : 's'} moved to trash` })
    },
  })()

  const updateAssignee = createThreadMutation('updateAssignee', {
    ...threadMutationConfigs.updateAssignee,
    onSuccess: (data, vars) => {
      const message = vars.assigneeId ? 'Thread assigned' : 'Thread unassigned'
      toastSuccess({ title: message })
    },
  })()

  const updateSubject = createThreadMutation('updateSubject', {
    ...threadMutationConfigs.updateSubject,
    onSuccess: () => toastSuccess({ title: 'Subject updated' }),
  })()

  const updateTags = createThreadMutation('updateTags', {
    ...threadMutationConfigs.updateTags,
    onSuccess: () => toastSuccess({ title: 'Tags updated' }),
  })()

  const markAsRead = createThreadMutation('markAsRead', {
    ...threadMutationConfigs.markAsRead,
    // No success toast for read status - too noisy
  })()

  const markAsUnread = createThreadMutation('markAsUnread', {
    ...threadMutationConfigs.markAsUnread,
    // No success toast for read status - too noisy
  })()

  const moveToInbox = createThreadMutation('moveToInbox', {
    ...threadMutationConfigs.moveToInbox,
    onSuccess: () => toastSuccess({ title: 'Thread moved to inbox' }),
  })()

  const moveBulkToInbox = createThreadMutation('moveBulkToInbox', {
    ...threadMutationConfigs.moveBulkToInbox,
    onSuccess: (data, vars) => {
      const count = vars.threadIds.length
      toastSuccess({ title: `${count} thread${count === 1 ? '' : 's'} moved to inbox` })
    },
  })()

  const updatePriority = createThreadMutation('updatePriority', {
    ...threadMutationConfigs.updatePriority,
    onSuccess: () => toastSuccess({ title: 'Priority updated' }),
  })()

  return {
    // Status mutations
    archiveThread,
    unarchiveThread,
    moveToTrash,
    restoreFromTrash,
    moveToTrashBulk,

    // Assignment mutations
    updateAssignee,

    // Content mutations
    updateSubject,
    updateTags,
    updatePriority,

    // Read status mutations
    markAsRead,
    markAsUnread,

    // Inbox mutations
    moveToInbox,
    moveBulkToInbox,

    // Legacy compatibility - mark these as deprecated
    /** @deprecated Use specific mutations instead */
    markReadMutation: markAsRead,
    /** @deprecated Use archiveThread instead */
    archiveMutation: archiveThread,
    /** @deprecated Use moveToTrash instead */
    deleteMutation: moveToTrash,
  }
}

/**
 * Individual mutation hooks for specific use cases
 * These can be used when you only need one specific mutation
 */

export const useArchiveThread = () =>
  createThreadMutation('archive', {
    ...threadMutationConfigs.archive,
    onSuccess: () => toastSuccess({ title: 'Thread archived' }),
  })()

export const useUnarchiveThread = () =>
  createThreadMutation('unarchive', {
    ...threadMutationConfigs.unarchive,
    onSuccess: () => toastSuccess({ title: 'Thread restored' }),
  })()

export const useMoveToTrash = () =>
  createThreadMutation('moveToTrash', {
    ...threadMutationConfigs.moveToTrash,
    onSuccess: () => toastSuccess({ title: 'Thread moved to trash' }),
  })()

export const useUpdateAssignee = () =>
  createThreadMutation('updateAssignee', {
    ...threadMutationConfigs.updateAssignee,
    onSuccess: (data, vars) => {
      const message = vars.assigneeId ? 'Thread assigned' : 'Thread unassigned'
      toastSuccess({ title: message })
    },
  })()

export const useMarkAsRead = () =>
  createThreadMutation('markAsRead', { ...threadMutationConfigs.markAsRead })()

export const useMarkAsUnread = () =>
  createThreadMutation('markAsUnread', { ...threadMutationConfigs.markAsUnread })()

export const useUpdateSubject = () =>
  createThreadMutation('updateSubject', {
    ...threadMutationConfigs.updateSubject,
    onSuccess: () => toastSuccess({ title: 'Subject updated' }),
  })()

export const useUpdateTags = () =>
  createThreadMutation('updateTags', {
    ...threadMutationConfigs.updateTags,
    onSuccess: () => toastSuccess({ title: 'Tags updated' }),
  })()

/**
 * Utility hook for custom thread mutations
 * Use this when you need to create a mutation that's not predefined
 */
export function useCustomThreadMutation<TVariables>(
  mutationKey: keyof typeof api.thread,
  config: ThreadMutationConfig<TVariables>
) {
  return createThreadMutation(mutationKey, config)()
}

// apps/web/src/components/threads/hooks/use-thread-mutation.ts

import { useCallback } from 'react'
import { useThreadStore, type ThreadMeta } from '../store'
import { toastError } from '@auxx/ui/components/toast'

interface UseThreadMutationOptions {
  /** Custom error message prefix */
  errorPrefix?: string
}

interface MutationLike<TInput, TOutput> {
  mutate: (
    input: TInput,
    options?: {
      onSuccess?: (data: TOutput) => void
      onError?: (error: Error) => void
    }
  ) => void
}

/**
 * Hook for optimistic thread mutations.
 *
 * This hook provides helpers for performing optimistic updates to threads.
 * When you call mutateThread, it:
 * 1. Immediately applies the update to the store (optimistic)
 * 2. Fires the actual mutation
 * 3. On success: confirms the optimistic update
 * 4. On error: rolls back only the keys this mutation changed
 *
 * The version-tracking system allows concurrent mutations on different fields
 * to coexist safely - if mutation A (archive) fails, it won't rollback
 * mutation B's changes (assign).
 *
 * @example
 * ```typescript
 * const { mutateThread, updateStatus } = useThreadMutation()
 * const archiveMutation = api.thread.archive.useMutation()
 *
 * // Generic approach
 * mutateThread(
 *   threadId,
 *   { status: 'ARCHIVED' },
 *   archiveMutation,
 *   { threadId }
 * )
 *
 * // Or use the convenience method
 * updateStatus(threadId, 'ARCHIVED', archiveMutation)
 * ```
 */
export function useThreadMutation() {
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)

  /**
   * Perform optimistic thread mutation.
   *
   * @param threadId - Thread to mutate
   * @param updates - Optimistic updates to apply immediately
   * @param mutation - tRPC mutation (or any mutation-like object with mutate method)
   * @param mutationInput - Input for the mutation
   * @param options - Optional error handling config
   */
  const mutateThread = useCallback(
    <TInput, TOutput>(
      threadId: string,
      updates: Partial<ThreadMeta>,
      mutation: MutationLike<TInput, TOutput>,
      mutationInput: TInput,
      options?: UseThreadMutationOptions
    ) => {
      // 1. Apply optimistic update, get version for this specific mutation
      const version = updateThreadOptimistic(threadId, updates)

      // 2. Fire mutation
      mutation.mutate(mutationInput, {
        onSuccess: () => {
          // Confirm this specific mutation (pass version)
          confirmOptimistic(threadId, version)
        },
        onError: (error) => {
          // Rollback only this mutation's changes (pass version)
          rollbackOptimistic(threadId, version)

          const message = error instanceof Error ? error.message : 'Unknown error'
          toastError({
            title: options?.errorPrefix ?? 'Update failed',
            description: message,
          })
        },
      })
    },
    [updateThreadOptimistic, confirmOptimistic, rollbackOptimistic]
  )

  /**
   * Convenience method for status changes.
   */
  const updateStatus = useCallback(
    <TInput extends { threadId: string }, TOutput>(
      threadId: string,
      status: ThreadMeta['status'],
      mutation: MutationLike<TInput, TOutput>,
      options?: UseThreadMutationOptions
    ) => {
      mutateThread(threadId, { status }, mutation, { threadId } as TInput, options)
    },
    [mutateThread]
  )

  /**
   * Convenience method for bulk status changes.
   */
  const updateStatusBulk = useCallback(
    <TInput extends { threadIds: string[] }, TOutput>(
      threadIds: string[],
      status: ThreadMeta['status'],
      mutation: MutationLike<TInput, TOutput>,
      options?: UseThreadMutationOptions
    ) => {
      // Apply optimistic updates to all threads, track each version
      const versions = threadIds.map((id) => ({
        id,
        version: updateThreadOptimistic(id, { status }),
      }))

      mutation.mutate({ threadIds } as TInput, {
        onSuccess: () => {
          // Confirm each mutation with its specific version
          versions.forEach(({ id, version }) => {
            confirmOptimistic(id, version)
          })
        },
        onError: (error) => {
          // Rollback each mutation with its specific version
          versions.forEach(({ id, version }) => {
            rollbackOptimistic(id, version)
          })

          const message = error instanceof Error ? error.message : 'Unknown error'
          toastError({
            title: options?.errorPrefix ?? 'Bulk update failed',
            description: message,
          })
        },
      })
    },
    [updateThreadOptimistic, confirmOptimistic, rollbackOptimistic]
  )

  /**
   * Convenience method for assignment changes.
   */
  const updateAssignee = useCallback(
    <TInput extends { threadId: string; assigneeActorId: ThreadMeta['assigneeActorId'] }, TOutput>(
      threadId: string,
      assigneeActorId: ThreadMeta['assigneeActorId'],
      mutation: MutationLike<TInput, TOutput>,
      options?: UseThreadMutationOptions
    ) => {
      mutateThread(
        threadId,
        { assigneeActorId },
        mutation,
        { threadId, assigneeActorId } as TInput,
        options
      )
    },
    [mutateThread]
  )

  /**
   * Convenience method for read status changes.
   */
  const updateReadStatus = useCallback(
    <TInput extends { threadId: string }, TOutput>(
      threadId: string,
      isUnread: boolean,
      mutation: MutationLike<TInput, TOutput>,
      options?: UseThreadMutationOptions
    ) => {
      mutateThread(threadId, { isUnread }, mutation, { threadId } as TInput, options)
    },
    [mutateThread]
  )

  return {
    mutateThread,
    updateStatus,
    updateStatusBulk,
    updateAssignee,
    updateReadStatus,
  }
}

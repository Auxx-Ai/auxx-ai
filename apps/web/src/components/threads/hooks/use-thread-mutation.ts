// apps/web/src/components/threads/hooks/use-thread-mutation.ts

import { useCallback } from 'react'
import { useThreadStore, type ThreadMeta } from '../store'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { toRecordId, type RecordId } from '@auxx/types/resource'

/**
 * Partial thread updates that can be applied optimistically.
 */
export type ThreadUpdates = Partial<
  Pick<ThreadMeta, 'status' | 'subject' | 'assigneeId' | 'inboxId' | 'isUnread'>
>

/**
 * Hook for optimistic thread mutations with simplified API.
 *
 * This hook provides a clean interface for thread mutations:
 * - Mutations are created internally (no need to pass them)
 * - Optimistic updates are applied automatically
 * - Rollback happens on error
 *
 * @example
 * ```typescript
 * const { update, updateBulk, remove, removeBulk } = useThreadMutation()
 *
 * // Single thread operations
 * update(threadId, { status: 'ARCHIVED' })
 * update(threadId, { assigneeId: { type: 'user', id: 'abc123' } })
 * update(threadId, { subject: 'New subject' })
 *
 * // Bulk operations
 * updateBulk(threadIds, { status: 'TRASH' })
 * updateBulk(threadIds, { inboxId: 'inbox123' })
 *
 * // Permanent delete
 * remove(threadId)
 * removeBulk(threadIds)
 * ```
 */
export function useThreadMutation() {
  // Store methods for optimistic updates
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)
  const removeThread = useThreadStore((s) => s.removeThread)

  // Create mutations internally
  const updateMutation = api.thread.update.useMutation()
  const updateBulkMutation = api.thread.updateBulk.useMutation()
  const removeMutation = api.thread.remove.useMutation()
  const removeBulkMutation = api.thread.removeBulk.useMutation()

  /**
   * Update a single thread optimistically.
   * Applies update to store immediately, then syncs with backend.
   */
  const update = useCallback(
    (threadId: string, updates: ThreadUpdates) => {
      // 1. Apply optimistic update to store
      const version = updateThreadOptimistic(threadId, updates)

      // 2. Create RecordId and call backend mutation
      const recordId = toRecordId('thread', threadId)

      // Convert assigneeId from ActorId object to string for API
      const apiUpdates = {
        ...updates,
        assigneeId: updates.assigneeId === undefined
          ? undefined
          : updates.assigneeId === null
            ? null
            : `${updates.assigneeId.type}:${updates.assigneeId.id}`,
      }

      updateMutation.mutate(
        { recordId, updates: apiUpdates },
        {
          onSuccess: () => confirmOptimistic(threadId, version),
          onError: (error) => {
            rollbackOptimistic(threadId, version)
            toastError({ title: 'Update failed', description: error.message })
          },
        }
      )
    },
    [updateThreadOptimistic, confirmOptimistic, rollbackOptimistic, updateMutation]
  )

  /**
   * Update multiple threads optimistically.
   * Applies updates to all threads in store, then syncs with backend.
   */
  const updateBulk = useCallback(
    (threadIds: string[], updates: ThreadUpdates) => {
      // 1. Apply optimistic updates to all threads
      const versions = threadIds.map((id) => ({
        id,
        version: updateThreadOptimistic(id, updates),
      }))

      // 2. Create RecordIds and call backend mutation
      const recordIds = threadIds.map((id) => toRecordId('thread', id))

      // Convert assigneeId from ActorId object to string for API
      const apiUpdates = {
        ...updates,
        assigneeId: updates.assigneeId === undefined
          ? undefined
          : updates.assigneeId === null
            ? null
            : `${updates.assigneeId.type}:${updates.assigneeId.id}`,
      }

      updateBulkMutation.mutate(
        { recordIds, updates: apiUpdates },
        {
          onSuccess: () => {
            versions.forEach(({ id, version }) => confirmOptimistic(id, version))
          },
          onError: (error) => {
            versions.forEach(({ id, version }) => rollbackOptimistic(id, version))
            toastError({ title: 'Bulk update failed', description: error.message })
          },
        }
      )
    },
    [updateThreadOptimistic, confirmOptimistic, rollbackOptimistic, updateBulkMutation]
  )

  /**
   * Permanently remove a thread.
   * Removes from store optimistically, then syncs with backend.
   */
  const remove = useCallback(
    (threadId: string) => {
      // 1. Remove from store optimistically
      removeThread(threadId)

      // 2. Create RecordId and call backend mutation
      const recordId = toRecordId('thread', threadId)

      removeMutation.mutate(
        { recordId },
        {
          onError: (error) => {
            // Note: Can't easily rollback a delete - would need to re-fetch
            toastError({ title: 'Delete failed', description: error.message })
          },
        }
      )
    },
    [removeThread, removeMutation]
  )

  /**
   * Permanently remove multiple threads.
   * Removes all from store optimistically, then syncs with backend.
   */
  const removeBulk = useCallback(
    (threadIds: string[]) => {
      // 1. Remove all from store optimistically
      threadIds.forEach((id) => removeThread(id))

      // 2. Create RecordIds and call backend mutation
      const recordIds = threadIds.map((id) => toRecordId('thread', id))

      removeBulkMutation.mutate(
        { recordIds },
        {
          onError: (error) => {
            // Note: Can't easily rollback bulk delete - would need to re-fetch
            toastError({ title: 'Bulk delete failed', description: error.message })
          },
        }
      )
    },
    [removeThread, removeBulkMutation]
  )

  return {
    update,
    updateBulk,
    remove,
    removeBulk,
    // Expose isPending states for UI
    isUpdating: updateMutation.isPending,
    isBulkUpdating: updateBulkMutation.isPending,
    isRemoving: removeMutation.isPending,
    isBulkRemoving: removeBulkMutation.isPending,
  }
}

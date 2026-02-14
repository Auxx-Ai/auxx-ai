// apps/web/src/components/threads/hooks/use-thread-mutation.ts

import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { type ThreadCountContext, useCountUpdates } from '~/components/mail/hooks'
import { type CountUpdates, useMailCountsStore } from '~/components/mail/store'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { type ThreadMeta, useThreadStore } from '../store'

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
 * update(threadId, { assigneeId: 'user:abc123' })
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
  // Get current user for count updates
  const { userId: currentUserId } = useUser()

  // Store methods for optimistic updates
  const updateThreadOptimistic = useThreadStore((s) => s.updateThreadOptimistic)
  const confirmOptimistic = useThreadStore((s) => s.confirmOptimistic)
  const rollbackOptimistic = useThreadStore((s) => s.rollbackOptimistic)
  const removeThread = useThreadStore((s) => s.removeThread)
  const getThread = useThreadStore((s) => s.getThread)

  // Count update store actions (direct access for bulk operations)
  const saveSnapshot = useMailCountsStore((s) => s.saveSnapshot)
  const restoreSnapshot = useMailCountsStore((s) => s.restoreSnapshot)
  const batchUpdate = useMailCountsStore((s) => s.batchUpdate)

  // Count update helpers (for status and read changes that handle batching internally)
  const { onMarkAsRead, onMarkAsUnread, onArchiveOrTrash } = useCountUpdates()

  // Create mutations internally
  const updateMutation = api.thread.update.useMutation()
  const updateBulkMutation = api.thread.updateBulk.useMutation()
  const removeMutation = api.thread.remove.useMutation()
  const removeBulkMutation = api.thread.removeBulk.useMutation()

  /**
   * Build thread context for count updates from current store state.
   */
  const buildThreadContext = useCallback(
    (threadId: string): ThreadCountContext | null => {
      const thread = getThread(threadId)
      if (!thread) return null

      return {
        isUnread: thread.isUnread,
        inboxId: thread.inboxId ?? null,
        assigneeId: thread.assigneeId ?? null,
        status: thread.status as 'OPEN' | 'ARCHIVED' | 'TRASH' | 'CLOSED' | 'SPAM',
        threadData: thread as unknown as Record<string, unknown>,
      }
    },
    [getThread]
  )

  /**
   * Apply count updates based on what's changing.
   * Handles bulk operations by calculating all changes and applying in one batch.
   */
  const applyCountUpdates = useCallback(
    (threadIds: string[], updates: ThreadUpdates) => {
      if (!currentUserId) return

      const contexts = threadIds
        .map((id) => buildThreadContext(id))
        .filter((ctx): ctx is ThreadCountContext => ctx !== null)

      if (contexts.length === 0) return

      // Handle status changes (archive/trash) - uses the helper which handles batching
      if (updates.status === 'ARCHIVED' || updates.status === 'TRASH') {
        onArchiveOrTrash(contexts, currentUserId)
        return // Status change handles all count decrements
      }

      // Handle read status changes - uses the helper which handles batching
      if (updates.isUnread !== undefined) {
        if (updates.isUnread) {
          onMarkAsUnread(contexts, currentUserId)
        } else {
          onMarkAsRead(contexts, currentUserId)
        }
        return
      }

      // For inbox and assignee changes, calculate all deltas and batch update
      // Save snapshot once at the beginning
      saveSnapshot()

      const countUpdates: CountUpdates = {
        inbox: 0,
        sharedInboxes: {},
        views: {},
      }

      // Handle inbox changes
      if (updates.inboxId) {
        const newInboxId = updates.inboxId.replace('inbox:', '')
        for (const context of contexts) {
          if (!context.isUnread || context.status !== 'OPEN') continue

          // Decrement old inbox
          if (context.inboxId) {
            countUpdates.sharedInboxes![context.inboxId] =
              (countUpdates.sharedInboxes![context.inboxId] ?? 0) - 1
          }
          // Increment new inbox
          countUpdates.sharedInboxes![newInboxId] =
            (countUpdates.sharedInboxes![newInboxId] ?? 0) + 1
        }
      }

      // Handle assignee changes
      if (updates.assigneeId !== undefined) {
        const newAssigneeId = updates.assigneeId?.replace('user:', '') ?? null
        for (const context of contexts) {
          if (!context.isUnread || context.status !== 'OPEN') continue

          const wasAssignedToMe = context.assigneeId === currentUserId
          const isAssigningToMe = newAssigneeId === currentUserId

          if (wasAssignedToMe && !isAssigningToMe) {
            // Unassigning from me - decrement personal inbox
            countUpdates.inbox! -= 1
          } else if (!wasAssignedToMe && isAssigningToMe) {
            // Assigning to me - increment personal inbox
            countUpdates.inbox! += 1
          }
        }
      }

      // Apply all changes in one batch
      batchUpdate(countUpdates)
    },
    [
      currentUserId,
      buildThreadContext,
      onMarkAsRead,
      onMarkAsUnread,
      onArchiveOrTrash,
      saveSnapshot,
      batchUpdate,
    ]
  )

  /**
   * Update a single thread optimistically.
   * Applies update to store immediately, then syncs with backend.
   */
  const update = useCallback(
    (threadId: string, updates: ThreadUpdates) => {
      // 1. Apply count updates BEFORE store update (needs current state)
      applyCountUpdates([threadId], updates)

      // 2. Apply optimistic update to store
      const version = updateThreadOptimistic(threadId, updates)

      // 3. Create RecordId and call backend mutation
      const recordId = toRecordId('thread', threadId)

      // assigneeId is already in "user:abc123" format from ActorPicker
      updateMutation.mutate(
        { recordId, updates },
        {
          onSuccess: () => confirmOptimistic(threadId, version),
          onError: (error) => {
            rollbackOptimistic(threadId, version)
            restoreSnapshot() // Rollback count changes
            toastError({ title: 'Update failed', description: error.message })
          },
        }
      )
    },
    [
      updateThreadOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      updateMutation,
      applyCountUpdates,
      restoreSnapshot,
    ]
  )

  /**
   * Update multiple threads optimistically.
   * Applies updates to all threads in store, then syncs with backend.
   */
  const updateBulk = useCallback(
    (threadIds: string[], updates: ThreadUpdates) => {
      // 1. Apply count updates BEFORE store update (needs current state)
      applyCountUpdates(threadIds, updates)

      // 2. Apply optimistic updates to all threads
      const versions = threadIds.map((id) => ({
        id,
        version: updateThreadOptimistic(id, updates),
      }))

      // 3. Create RecordIds and call backend mutation
      const recordIds = threadIds.map((id) => toRecordId('thread', id))

      // assigneeId is already in "user:abc123" format from ActorPicker
      updateBulkMutation.mutate(
        { recordIds, updates },
        {
          onSuccess: () => {
            versions.forEach(({ id, version }) => confirmOptimistic(id, version))
          },
          onError: (error) => {
            versions.forEach(({ id, version }) => rollbackOptimistic(id, version))
            restoreSnapshot() // Rollback count changes
            toastError({ title: 'Bulk update failed', description: error.message })
          },
        }
      )
    },
    [
      updateThreadOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
      updateBulkMutation,
      applyCountUpdates,
      restoreSnapshot,
    ]
  )

  /**
   * Permanently remove a thread.
   * Removes from store optimistically, then syncs with backend.
   */
  const remove = useCallback(
    (threadId: string) => {
      // 1. Update counts BEFORE removal (treat as archive for count purposes)
      saveSnapshot()
      if (currentUserId) {
        const context = buildThreadContext(threadId)
        if (context?.isUnread && context.status === 'OPEN') {
          const countUpdates: CountUpdates = { inbox: 0, sharedInboxes: {} }
          if (context.assigneeId === currentUserId) {
            countUpdates.inbox = -1
          }
          if (context.inboxId) {
            countUpdates.sharedInboxes![context.inboxId] = -1
          }
          batchUpdate(countUpdates)
        }
      }

      // 2. Remove from store optimistically
      removeThread(threadId)

      // 3. Create RecordId and call backend mutation
      const recordId = toRecordId('thread', threadId)

      removeMutation.mutate(
        { recordId },
        {
          onError: (error) => {
            // Note: Can't easily rollback a delete - would need to re-fetch
            restoreSnapshot()
            toastError({ title: 'Delete failed', description: error.message })
          },
        }
      )
    },
    [
      removeThread,
      removeMutation,
      currentUserId,
      buildThreadContext,
      restoreSnapshot,
      saveSnapshot,
      batchUpdate,
    ]
  )

  /**
   * Permanently remove multiple threads.
   * Removes all from store optimistically, then syncs with backend.
   */
  const removeBulk = useCallback(
    (threadIds: string[]) => {
      // 1. Update counts BEFORE removal
      saveSnapshot()
      if (currentUserId) {
        const contexts = threadIds
          .map((id) => buildThreadContext(id))
          .filter((ctx): ctx is ThreadCountContext => ctx !== null)

        const countUpdates: CountUpdates = { inbox: 0, sharedInboxes: {} }
        for (const context of contexts) {
          if (!context.isUnread || context.status !== 'OPEN') continue
          if (context.assigneeId === currentUserId) {
            countUpdates.inbox! -= 1
          }
          if (context.inboxId) {
            countUpdates.sharedInboxes![context.inboxId] =
              (countUpdates.sharedInboxes![context.inboxId] ?? 0) - 1
          }
        }
        batchUpdate(countUpdates)
      }

      // 2. Remove all from store optimistically
      threadIds.forEach((id) => removeThread(id))

      // 3. Create RecordIds and call backend mutation
      const recordIds = threadIds.map((id) => toRecordId('thread', id))

      removeBulkMutation.mutate(
        { recordIds },
        {
          onError: (error) => {
            // Note: Can't easily rollback bulk delete - would need to re-fetch
            restoreSnapshot()
            toastError({ title: 'Bulk delete failed', description: error.message })
          },
        }
      )
    },
    [
      removeThread,
      removeBulkMutation,
      currentUserId,
      buildThreadContext,
      restoreSnapshot,
      saveSnapshot,
      batchUpdate,
    ]
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

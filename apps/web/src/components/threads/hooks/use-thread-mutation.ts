// apps/web/src/components/threads/hooks/use-thread-mutation.ts

import { safeParseActorId } from '@auxx/types/actor'
import { getInstanceId, toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useCountUpdates } from '~/components/mail/hooks'
import { type CountUpdates, useMailCountsStore } from '~/components/mail/store'
import {
  buildThreadCountContext,
  type ThreadCountContext,
} from '~/components/mail/utils/thread-count-context'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { type ThreadMeta, useThreadSelectionStore, useThreadStore } from '../store'

/**
 * Partial thread updates that can be applied optimistically.
 */
export type ThreadUpdates = Partial<
  Pick<
    ThreadMeta,
    'status' | 'subject' | 'assigneeId' | 'inboxId' | 'ticketId' | 'isUnread' | 'mergedIntoThreadId'
  >
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
  const undeleteThread = useThreadStore((s) => s.undeleteThread)
  const getThread = useThreadStore((s) => s.getThread)
  const setActiveThread = useThreadSelectionStore((s) => s.setActiveThread)

  // Close the active thread if it was just tombstoned. Read via getState so
  // the callback dependency stays stable; mail-box's URL-sync effect clears
  // `?tid=` once activeThreadId flips to null.
  const closeIfActive = useCallback(
    (threadIds: string[]) => {
      const activeId = useThreadSelectionStore.getState().activeThreadId
      if (activeId && threadIds.includes(activeId)) {
        setActiveThread(null)
      }
    },
    [setActiveThread]
  )

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
   * Id normalization lives in the shared producer — see `thread-count-context`.
   */
  const buildThreadContext = useCallback(
    (threadId: string): ThreadCountContext | null => {
      const thread = getThread(threadId)
      return thread ? buildThreadCountContext(thread) : null
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
        // Parse the def off, don't string-strip it: a mailbox RecordId is
        // `inbox:<id>` OR `personal_inbox:<id>` (plan 40 §3 / 40a §5.1), and
        // `.replace('inbox:', '')` mangles the second into `personal_<id>`
        // (the substring matches mid-word) rather than yielding the instance
        // id. The count delta then lands under a key nothing reads, so the
        // badge silently never moves — and it fails the same way for any
        // def-CUID-keyed RecordId, where the strip is simply a no-op.
        const newInboxId = getInstanceId(updates.inboxId)
        for (const context of contexts) {
          if (!context.isUnread || context.status !== 'OPEN') continue

          // Decrement old inbox. `inboxInstanceId` is already parsed off the
          // stored RecordId by the shared context producer (plan 44 §3.3) — the
          // debit used to key off the whole RecordId and so never matched the
          // badge's bare-id keyspace.
          if (context.inboxInstanceId) {
            countUpdates.sharedInboxes![context.inboxInstanceId] =
              (countUpdates.sharedInboxes![context.inboxInstanceId] ?? 0) - 1
          }
          // Increment new inbox
          countUpdates.sharedInboxes![newInboxId] =
            (countUpdates.sharedInboxes![newInboxId] ?? 0) + 1
        }
      }

      // Handle assignee changes
      if (updates.assigneeId !== undefined) {
        // Parse, don't strip — same rule as the inbox RecordId above.
        const newAssigneeId = safeParseActorId(updates.assigneeId)?.id ?? null
        for (const context of contexts) {
          if (!context.isUnread || context.status !== 'OPEN') continue

          const wasAssignedToMe = context.assigneeUserId === currentUserId
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
      updateMutation.mutate,
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
      updateBulkMutation.mutate,
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
          if (context.assigneeUserId === currentUserId) {
            countUpdates.inbox = -1
          }
          if (context.inboxInstanceId) {
            countUpdates.sharedInboxes![context.inboxInstanceId] = -1
          }
          batchUpdate(countUpdates)
        }
      }

      // 2. Snapshot + tombstone in store. Tombstone hides the sidebar row
      //    without invalidating the cached `thread.listIds` query.
      const previous = getThread(threadId)
      removeThread(threadId)
      closeIfActive([threadId])

      // 3. Create RecordId and call backend mutation
      const recordId = toRecordId('thread', threadId)

      removeMutation.mutate(
        { recordId },
        {
          onError: (error) => {
            restoreSnapshot()
            undeleteThread(threadId, previous)
            toastError({ title: 'Delete failed', description: error.message })
          },
        }
      )
    },
    [
      removeThread,
      undeleteThread,
      getThread,
      removeMutation.mutate,
      currentUserId,
      buildThreadContext,
      restoreSnapshot,
      saveSnapshot,
      batchUpdate,
      closeIfActive,
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
          if (context.assigneeUserId === currentUserId) {
            countUpdates.inbox! -= 1
          }
          if (context.inboxInstanceId) {
            countUpdates.sharedInboxes![context.inboxInstanceId] =
              (countUpdates.sharedInboxes![context.inboxInstanceId] ?? 0) - 1
          }
        }
        batchUpdate(countUpdates)
      }

      // 2. Snapshot + tombstone each thread (sidebar hides via isDeleted flag)
      const previous = new Map<string, ThreadMeta>()
      for (const id of threadIds) {
        const t = getThread(id)
        if (t) previous.set(id, t)
        removeThread(id)
      }
      closeIfActive(threadIds)

      // 3. Create RecordIds and call backend mutation
      const recordIds = threadIds.map((id) => toRecordId('thread', id))

      removeBulkMutation.mutate(
        { recordIds },
        {
          onError: (error) => {
            restoreSnapshot()
            for (const id of threadIds) {
              undeleteThread(id, previous.get(id))
            }
            toastError({ title: 'Bulk delete failed', description: error.message })
          },
        }
      )
    },
    [
      removeThread,
      undeleteThread,
      getThread,
      removeBulkMutation.mutate,
      currentUserId,
      buildThreadContext,
      restoreSnapshot,
      saveSnapshot,
      batchUpdate,
      closeIfActive,
    ]
  )

  /**
   * Merge one or more source threads into a target. Sources are tombstoned in
   * the store so they disappear from list views immediately; the server
   * routes through ThreadMergeService and reconciles the target's denormalized
   * counts on the next fetch.
   */
  const merge = useCallback(
    (sourceThreadIds: string[], targetThreadId: string) => {
      if (sourceThreadIds.length === 0) return

      // Snapshot sources before tombstoning so rollback can restore them.
      const previous = new Map<string, ThreadMeta>()
      const directEntries = sourceThreadIds.map((id) => {
        const src = getThread(id)
        if (src) previous.set(id, src)
        return {
          threadId: id,
          subject: src?.subject ?? '',
          mergedAt: new Date().toISOString(),
          mergedById: currentUserId ?? '',
          batchId: '',
          messageCount: src?.messageCount ?? 0,
        }
      })
      // Carry the flatten invariant client-side: pull each source's existing
      // `mergeData.sources` (transitive ancestors) and bubble them up to the
      // target alongside the direct sources.
      const descendantEntries = sourceThreadIds.flatMap(
        (id) => getThread(id)?.mergeData?.sources ?? []
      )

      const targetThread = getThread(targetThreadId)
      let targetVersion: number | null = null
      if (targetThread) {
        targetVersion = updateThreadOptimistic(targetThreadId, {
          mergeData: {
            ...(targetThread.mergeData ?? {}),
            sources: [
              ...(targetThread.mergeData?.sources ?? []),
              ...directEntries,
              ...descendantEntries,
            ],
          },
        })
      }

      for (const id of sourceThreadIds) {
        removeThread(id)
      }
      closeIfActive(sourceThreadIds)

      const recordIds = sourceThreadIds.map((id) => toRecordId('thread', id))
      const mergedIntoRecord = toRecordId('thread', targetThreadId)

      updateBulkMutation.mutate(
        { recordIds, updates: { mergedIntoThreadId: mergedIntoRecord } },
        {
          onSuccess: () => {
            if (targetVersion !== null) confirmOptimistic(targetThreadId, targetVersion)
          },
          onError: (error) => {
            if (targetVersion !== null) rollbackOptimistic(targetThreadId, targetVersion)
            for (const id of sourceThreadIds) {
              undeleteThread(id, previous.get(id))
            }
            toastError({ title: 'Merge failed', description: error.message })
          },
        }
      )
    },
    [
      getThread,
      removeThread,
      undeleteThread,
      updateBulkMutation.mutate,
      closeIfActive,
      currentUserId,
      updateThreadOptimistic,
      confirmOptimistic,
      rollbackOptimistic,
    ]
  )

  /**
   * Unmerge a single source thread, restoring its content and clearing the
   * merge pointer.
   */
  const unmerge = useCallback(
    (sourceThreadId: string) => {
      const recordId = toRecordId('thread', sourceThreadId)
      updateMutation.mutate(
        { recordId, updates: { mergedIntoThreadId: null } },
        {
          onError: (error) => {
            toastError({ title: 'Unmerge failed', description: error.message })
          },
        }
      )
    },
    [updateMutation.mutate]
  )

  return {
    update,
    updateBulk,
    remove,
    removeBulk,
    merge,
    unmerge,
    // Expose isPending states for UI
    isUpdating: updateMutation.isPending,
    isBulkUpdating: updateBulkMutation.isPending,
    isRemoving: removeMutation.isPending,
    isBulkRemoving: removeBulkMutation.isPending,
  }
}

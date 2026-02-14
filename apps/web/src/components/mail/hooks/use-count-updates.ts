// apps/web/src/components/mail/hooks/use-count-updates.ts

import { type ConditionGroup, evaluateConditions } from '@auxx/lib/conditions/client'
import { useCallback } from 'react'
import { type CountUpdates, useMailCountsStore } from '../store'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Context about a thread needed to calculate which counts to update.
 * This should be derived from the thread's current state before mutation.
 */
export interface ThreadCountContext {
  isUnread: boolean
  inboxId: string | null
  assigneeId: string | null // Plain user ID (not ActorId format)
  status: 'OPEN' | 'ARCHIVED' | 'TRASH' | 'CLOSED' | 'SPAM'
  /** Full thread data for view filter evaluation */
  threadData?: Record<string, unknown>
}

/**
 * View definition for filter evaluation.
 */
export interface ViewDefinition {
  id: string
  filters: ConditionGroup[]
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook that provides optimistic count update helpers.
 * Call these BEFORE or alongside mutations to keep counts in sync.
 *
 * @param views - View definitions with their filter conditions (for view count updates)
 *
 * @example
 * const { onMarkAsRead, rollback } = useCountUpdates(views)
 *
 * // In mutation onMutate:
 * onMarkAsRead([threadContext], currentUserId)
 *
 * // In mutation onError:
 * rollback()
 */
export function useCountUpdates(views: ViewDefinition[] = []) {
  const batchUpdate = useMailCountsStore((s) => s.batchUpdate)
  const incrementDrafts = useMailCountsStore((s) => s.incrementDrafts)
  const decrementDrafts = useMailCountsStore((s) => s.decrementDrafts)
  const saveSnapshot = useMailCountsStore((s) => s.saveSnapshot)
  const restoreSnapshot = useMailCountsStore((s) => s.restoreSnapshot)

  /**
   * Field resolver for evaluating view conditions against thread data.
   */
  const fieldResolver = useCallback((thread: Record<string, unknown>, fieldId: string): unknown => {
    // Handle common field mappings
    switch (fieldId) {
      case 'status':
        return thread.status
      case 'inbox':
        return thread.inboxId
      case 'assignee':
        return thread.assigneeId
      case 'tags':
        return thread.tagIds
      case 'tag':
        return thread.tagIds
      case 'labels':
        return thread.labelIds
      case 'subject':
        return thread.subject
      case 'messageCount':
        return thread.messageCount
      case 'lastMessageAt':
        return thread.lastMessageAt
      case 'createdAt':
        return thread.createdAt
      default:
        return thread[fieldId]
    }
  }, [])

  /**
   * Determine which views a thread matches based on filter conditions.
   */
  const getMatchingViewIds = useCallback(
    (threadData: Record<string, unknown>): string[] => {
      return views
        .filter((view) => evaluateConditions(threadData, view.filters, fieldResolver))
        .map((view) => view.id)
    },
    [views, fieldResolver]
  )

  /**
   * Update counts when marking thread(s) as read.
   * Call this in onMutate of the readStatus mutation.
   */
  const onMarkAsRead = useCallback(
    (threads: ThreadCountContext[], currentUserId: string) => {
      saveSnapshot()
      const updates: CountUpdates = { inbox: 0, sharedInboxes: {}, views: {} }

      for (const thread of threads) {
        if (!thread.isUnread) continue // Already read, no count change
        if (thread.status !== 'OPEN') continue // Only OPEN threads affect counts

        // Decrement personal inbox if assigned to current user
        if (thread.assigneeId === currentUserId) {
          updates.inbox! -= 1
        }

        // Decrement shared inbox count
        if (thread.inboxId) {
          updates.sharedInboxes![thread.inboxId] = (updates.sharedInboxes![thread.inboxId] ?? 0) - 1
        }

        // Decrement view counts using filter evaluation
        if (thread.threadData) {
          const matchingViewIds = getMatchingViewIds(thread.threadData)
          for (const viewId of matchingViewIds) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) - 1
          }
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update counts when marking thread(s) as unread.
   * Call this in onMutate of the readStatus mutation.
   */
  const onMarkAsUnread = useCallback(
    (threads: ThreadCountContext[], currentUserId: string) => {
      saveSnapshot()
      const updates: CountUpdates = { inbox: 0, sharedInboxes: {}, views: {} }

      for (const thread of threads) {
        if (thread.isUnread) continue // Already unread, no count change
        if (thread.status !== 'OPEN') continue // Only OPEN threads affect counts

        // Increment personal inbox if assigned to current user
        if (thread.assigneeId === currentUserId) {
          updates.inbox! += 1
        }

        // Increment shared inbox count
        if (thread.inboxId) {
          updates.sharedInboxes![thread.inboxId] = (updates.sharedInboxes![thread.inboxId] ?? 0) + 1
        }

        // Increment view counts using filter evaluation
        if (thread.threadData) {
          const matchingViewIds = getMatchingViewIds(thread.threadData)
          for (const viewId of matchingViewIds) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) + 1
          }
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update counts when moving thread to a different inbox.
   * Only updates if thread is unread and OPEN.
   */
  const onMoveToInbox = useCallback(
    (thread: ThreadCountContext, toInboxId: string) => {
      if (!thread.isUnread) return // Read threads don't affect counts
      if (thread.status !== 'OPEN') return

      saveSnapshot()
      const updates: CountUpdates = { sharedInboxes: {}, views: {} }

      // Decrement source inbox
      if (thread.inboxId) {
        updates.sharedInboxes![thread.inboxId] = -1
      }

      // Increment destination inbox
      updates.sharedInboxes![toInboxId] = 1

      // Recalculate view counts with new inbox
      if (thread.threadData) {
        const oldViewIds = getMatchingViewIds(thread.threadData)
        const newThreadData = { ...thread.threadData, inboxId: toInboxId }
        const newViewIds = getMatchingViewIds(newThreadData)

        // Decrement views that no longer match
        for (const viewId of oldViewIds) {
          if (!newViewIds.includes(viewId)) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) - 1
          }
        }

        // Increment views that now match
        for (const viewId of newViewIds) {
          if (!oldViewIds.includes(viewId)) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) + 1
          }
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update counts when assigning thread to a user.
   * Only updates personal inbox count if thread is unread and OPEN.
   */
  const onAssignThread = useCallback(
    (thread: ThreadCountContext, toUserId: string | null, currentUserId: string) => {
      if (!thread.isUnread) return // Read threads don't affect counts
      if (thread.status !== 'OPEN') return

      const wasAssignedToMe = thread.assigneeId === currentUserId
      const isAssigningToMe = toUserId === currentUserId

      if (wasAssignedToMe === isAssigningToMe) return // No change for current user

      saveSnapshot()
      const updates: CountUpdates = { inbox: 0, views: {} }

      if (wasAssignedToMe && !isAssigningToMe) {
        // Unassigning from me
        updates.inbox = -1
      } else if (!wasAssignedToMe && isAssigningToMe) {
        // Assigning to me
        updates.inbox = 1
      }

      // Recalculate view counts with new assignee
      if (thread.threadData) {
        const oldViewIds = getMatchingViewIds(thread.threadData)
        const newThreadData = { ...thread.threadData, assigneeId: toUserId }
        const newViewIds = getMatchingViewIds(newThreadData)

        for (const viewId of oldViewIds) {
          if (!newViewIds.includes(viewId)) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) - 1
          }
        }
        for (const viewId of newViewIds) {
          if (!oldViewIds.includes(viewId)) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) + 1
          }
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update counts when archiving/trashing threads.
   * Decrements all relevant counts since thread leaves OPEN state.
   */
  const onArchiveOrTrash = useCallback(
    (threads: ThreadCountContext[], currentUserId: string) => {
      saveSnapshot()
      const updates: CountUpdates = { inbox: 0, sharedInboxes: {}, views: {} }

      for (const thread of threads) {
        if (!thread.isUnread) continue
        if (thread.status !== 'OPEN') continue // Already not OPEN

        // Decrement personal inbox if assigned to current user
        if (thread.assigneeId === currentUserId) {
          updates.inbox! -= 1
        }

        // Decrement shared inbox count
        if (thread.inboxId) {
          updates.sharedInboxes![thread.inboxId] = (updates.sharedInboxes![thread.inboxId] ?? 0) - 1
        }

        // Decrement all matching view counts
        if (thread.threadData) {
          const matchingViewIds = getMatchingViewIds(thread.threadData)
          for (const viewId of matchingViewIds) {
            updates.views![viewId] = (updates.views![viewId] ?? 0) - 1
          }
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update counts when reopening a thread.
   * Increments relevant counts since thread returns to OPEN state.
   */
  const onReopenThread = useCallback(
    (thread: ThreadCountContext, currentUserId: string) => {
      if (!thread.isUnread) return // Read threads don't affect counts
      // Thread was not OPEN before, but will be OPEN after

      saveSnapshot()
      const updates: CountUpdates = { inbox: 0, sharedInboxes: {}, views: {} }

      // Increment personal inbox if assigned to current user
      if (thread.assigneeId === currentUserId) {
        updates.inbox! += 1
      }

      // Increment shared inbox count
      if (thread.inboxId) {
        updates.sharedInboxes![thread.inboxId] = 1
      }

      // Increment all matching view counts
      if (thread.threadData) {
        // Evaluate with OPEN status
        const newThreadData = { ...thread.threadData, status: 'OPEN' }
        const matchingViewIds = getMatchingViewIds(newThreadData)
        for (const viewId of matchingViewIds) {
          updates.views![viewId] = (updates.views![viewId] ?? 0) + 1
        }
      }

      batchUpdate(updates)
    },
    [batchUpdate, saveSnapshot, getMatchingViewIds]
  )

  /**
   * Update draft count when creating a new draft.
   */
  const onCreateDraft = useCallback(() => {
    saveSnapshot()
    incrementDrafts(1)
  }, [incrementDrafts, saveSnapshot])

  /**
   * Update draft count when deleting a draft.
   */
  const onDeleteDraft = useCallback(() => {
    saveSnapshot()
    decrementDrafts(1)
  }, [decrementDrafts, saveSnapshot])

  /**
   * Update draft count when sending a draft (draft becomes sent message).
   */
  const onSendDraft = useCallback(() => {
    saveSnapshot()
    decrementDrafts(1)
  }, [decrementDrafts, saveSnapshot])

  /**
   * Rollback to previous state on mutation error.
   */
  const rollback = useCallback(() => {
    restoreSnapshot()
  }, [restoreSnapshot])

  return {
    onMarkAsRead,
    onMarkAsUnread,
    onMoveToInbox,
    onAssignThread,
    onArchiveOrTrash,
    onReopenThread,
    onCreateDraft,
    onDeleteDraft,
    onSendDraft,
    rollback,
  }
}

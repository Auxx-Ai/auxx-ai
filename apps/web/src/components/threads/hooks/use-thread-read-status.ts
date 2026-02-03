// apps/web/src/components/threads/hooks/use-thread-read-status.ts

import { useCallback } from 'react'
import { useThreadStore } from '../store'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useUser } from '~/hooks/use-user'
import { useCountUpdates, type ThreadCountContext } from '~/components/mail/hooks'

interface UseThreadReadStatusResult {
  isUnread: boolean
  markAsRead: () => void
  markAsUnread: () => void
}

/**
 * Hook to get and mutate thread read status.
 * Uses granular selector on ThreadStore for optimal re-renders.
 * Integrates with mail counts store for optimistic count updates.
 *
 * @example
 * const { isUnread, markAsRead } = useThreadReadStatus('thread123')
 */
export function useThreadReadStatus(threadId: string | null): UseThreadReadStatusResult {
  const { userId: currentUserId } = useUser()

  // Granular selector - only re-renders when THIS thread's isUnread changes
  const isUnread = useThreadStore(
    useCallback(
      (state) => (threadId ? state.threads.get(threadId)?.isUnread : undefined),
      [threadId]
    )
  )

  // Get full thread data for count context
  const thread = useThreadStore(
    useCallback(
      (state) => (threadId ? state.threads.get(threadId) : undefined),
      [threadId]
    )
  )

  const updateThread = useThreadStore((s) => s.updateThread)

  // Count update helpers (no views for now - views need to be passed from context)
  const { onMarkAsRead, onMarkAsUnread, rollback } = useCountUpdates()

  // Single mutation with optimistic updates
  const readStatus = api.thread.readStatus.useMutation({
    onMutate: ({ isRead }) => {
      if (!threadId || !thread || !currentUserId) return

      // Build context from current thread state
      const context: ThreadCountContext = {
        isUnread: thread.isUnread,
        inboxId: thread.inboxId ?? null,
        assigneeId: thread.assigneeId ?? null,
        status: thread.status as 'OPEN' | 'ARCHIVED' | 'TRASH' | 'CLOSED' | 'SPAM',
        threadData: thread as unknown as Record<string, unknown>,
      }

      // Update ThreadStore (for UI)
      updateThread(threadId, { isUnread: !isRead })

      // Update counts (for sidebar badges)
      if (isRead) {
        onMarkAsRead([context], currentUserId)
      } else {
        onMarkAsUnread([context], currentUserId)
      }
    },
    onError: (error, variables) => {
      // Rollback ThreadStore
      if (threadId) {
        updateThread(threadId, { isUnread: variables.isRead })
      }
      // Rollback counts
      rollback()
      toastError({ title: 'Failed to update read status', description: error.message })
    },
  })

  return {
    isUnread: isUnread ?? true,
    markAsRead: useCallback(() => {
      if (threadId) {
        readStatus.mutate({ threadId, isRead: true })
      }
    }, [threadId, readStatus]),
    markAsUnread: useCallback(() => {
      if (threadId) {
        readStatus.mutate({ threadId, isRead: false })
      }
    }, [threadId, readStatus]),
  }
}

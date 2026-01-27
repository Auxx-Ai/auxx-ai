// apps/web/src/components/threads/hooks/use-thread-read-status.ts

import { useCallback } from 'react'
import { useThreadReadStatusStore, useThreadStore } from '../store'
import { api } from '~/trpc/react'

interface UseThreadReadStatusResult {
  isUnread: boolean
  isLoading: boolean
  markAsRead: () => void
  markAsUnread: () => void
}

/**
 * Hook to get and mutate thread read status.
 * Primary source: thread store (populated by getByIds with isUnread)
 * Secondary source: read status store (for optimistic updates)
 *
 * @example
 * const { isUnread, markAsRead } = useThreadReadStatus('thread123')
 */
export function useThreadReadStatus(threadId: string | null): UseThreadReadStatusResult {
  // Primary source: thread store (populated by getByIds)
  const threadIsUnread = useThreadStore(
    useCallback(
      (state) => (threadId ? state.threads.get(threadId)?.isUnread : undefined),
      [threadId]
    )
  )

  // Secondary source: read status store (for optimistic updates)
  const optimisticStatus = useThreadReadStatusStore(
    useCallback((state) => (threadId ? state.status.get(threadId) : undefined), [threadId])
  )

  const isLoading = useThreadStore(
    useCallback(
      (state) =>
        threadId
          ? state.pendingIds.has(threadId) || state.loadingIds.has(threadId)
          : false,
      [threadId]
    )
  )

  const storeMarkAsRead = useThreadReadStatusStore((s) => s.markAsRead)
  const storeMarkAsUnread = useThreadReadStatusStore((s) => s.markAsUnread)
  const updateThread = useThreadStore((s) => s.updateThread)

  // Mutations with optimistic updates to both stores
  const markAsReadMutation = api.thread.markAsRead.useMutation({
    onMutate: () => {
      if (threadId) {
        storeMarkAsRead(threadId)
        updateThread(threadId, { isUnread: false })
      }
    },
  })

  const markAsUnreadMutation = api.thread.markAsUnread.useMutation({
    onMutate: () => {
      if (threadId) {
        storeMarkAsUnread(threadId)
        updateThread(threadId, { isUnread: true })
      }
    },
  })

  // Optimistic status takes precedence, then thread store, default to true
  const isUnread = optimisticStatus ?? threadIsUnread ?? true

  return {
    isUnread,
    isLoading,
    markAsRead: useCallback(() => {
      if (threadId) {
        markAsReadMutation.mutate({ threadId })
      }
    }, [threadId, markAsReadMutation]),
    markAsUnread: useCallback(() => {
      if (threadId) {
        markAsUnreadMutation.mutate({ threadId })
      }
    }, [threadId, markAsUnreadMutation]),
  }
}

// apps/web/src/components/threads/hooks/use-thread-read-status.ts

import { useCallback } from 'react'
import { useThreadStore } from '../store'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'

interface UseThreadReadStatusResult {
  isUnread: boolean
  markAsRead: () => void
  markAsUnread: () => void
}

/**
 * Hook to get and mutate thread read status.
 * Uses granular selector on ThreadStore for optimal re-renders.
 *
 * @example
 * const { isUnread, markAsRead } = useThreadReadStatus('thread123')
 */
export function useThreadReadStatus(threadId: string | null): UseThreadReadStatusResult {
  // Granular selector - only re-renders when THIS thread's isUnread changes
  const isUnread = useThreadStore(
    useCallback(
      (state) => (threadId ? state.threads.get(threadId)?.isUnread : undefined),
      [threadId]
    )
  )

  const updateThread = useThreadStore((s) => s.updateThread)

  // Single mutation with optimistic updates
  const readStatus = api.thread.readStatus.useMutation({
    onMutate: ({ isRead }) => {
      if (threadId) {
        updateThread(threadId, { isUnread: !isRead })
      }
    },
    onError: (error) => {
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

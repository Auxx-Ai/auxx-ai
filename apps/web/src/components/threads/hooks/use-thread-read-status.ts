// apps/web/src/components/threads/hooks/use-thread-read-status.ts

import { toRecordId } from '@auxx/types/resource'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { type ThreadCountContext, useCountUpdates } from '~/components/mail/hooks'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { useThreadStore } from '../store'

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
 * Writes go through the unified `thread.update` endpoint (`{ isUnread }`), which
 * routes read-state to UnreadService on the server — the single write path
 * shared with bulk/`U`-shortcut read toggles.
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
    useCallback((state) => (threadId ? state.threads.get(threadId) : undefined), [threadId])
  )

  const updateThread = useThreadStore((s) => s.updateThread)

  // Count update helpers (no views for now - views need to be passed from context)
  const { onMarkAsRead, onMarkAsUnread, rollback } = useCountUpdates()

  // Unified update endpoint with optimistic updates. `isUnread` is peeled off
  // server-side and applied via UnreadService.
  const readStatus = api.thread.update.useMutation({
    onMutate: ({ updates }) => {
      if (!threadId || !thread || !currentUserId || updates.isUnread === undefined) return

      // Build context from current thread state
      const context: ThreadCountContext = {
        isUnread: thread.isUnread,
        inboxId: thread.inboxId ?? null,
        assigneeId: thread.assigneeId ?? null,
        status: thread.status as 'OPEN' | 'ARCHIVED' | 'TRASH' | 'CLOSED' | 'SPAM',
        threadData: thread as unknown as Record<string, unknown>,
      }

      // Update ThreadStore (for UI)
      updateThread(threadId, { isUnread: updates.isUnread })

      // Update counts (for sidebar badges)
      if (updates.isUnread) {
        onMarkAsUnread([context], currentUserId)
      } else {
        onMarkAsRead([context], currentUserId)
      }
    },
    onError: (error, variables) => {
      // Rollback ThreadStore to the pre-toggle state
      if (threadId && variables.updates.isUnread !== undefined) {
        updateThread(threadId, { isUnread: !variables.updates.isUnread })
      }
      // Rollback counts
      rollback()
      toastError({ title: 'Failed to update read status', description: error.message })
    },
  })

  // Use a ref so the callbacks stay stable across renders
  const mutateRef = useRef(readStatus.mutate)
  mutateRef.current = readStatus.mutate

  return {
    isUnread: isUnread ?? true,
    markAsRead: useCallback(() => {
      if (threadId) {
        mutateRef.current({
          recordId: toRecordId('thread', threadId),
          updates: { isUnread: false },
        })
      }
    }, [threadId]),
    markAsUnread: useCallback(() => {
      if (threadId) {
        mutateRef.current({ recordId: toRecordId('thread', threadId), updates: { isUnread: true } })
      }
    }, [threadId]),
  }
}

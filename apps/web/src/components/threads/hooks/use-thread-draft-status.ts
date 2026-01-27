// apps/web/src/components/threads/hooks/use-thread-draft-status.ts

import { useCallback, useLayoutEffect } from 'react'
import { useThreadDraftStore } from '../store'

interface UseThreadDraftStatusResult {
  /** Whether the thread has a draft */
  hasDraft: boolean
  /** Whether the draft status is being loaded */
  isLoading: boolean
}

/**
 * Hook to get thread draft status.
 * Automatically requests draft status if not in store.
 *
 * @example
 * const { hasDraft, isLoading } = useThreadDraftStatus('thread123')
 */
export function useThreadDraftStatus(
  threadId: string | null | undefined
): UseThreadDraftStatusResult {
  const hasDraft = useThreadDraftStore(
    useCallback(
      (state) => (threadId ? state.status.get(threadId) ?? false : false),
      [threadId]
    )
  )

  const isLoading = useThreadDraftStore(
    useCallback(
      (state) =>
        threadId
          ? state.pendingIds.has(threadId) || state.loadingIds.has(threadId)
          : false,
      [threadId]
    )
  )

  const requestStatus = useThreadDraftStore((s) => s.requestStatus)

  // Request draft status when threadId changes
  useLayoutEffect(() => {
    if (threadId) {
      requestStatus(threadId)
    }
  }, [threadId, requestStatus])

  return {
    hasDraft,
    isLoading,
  }
}

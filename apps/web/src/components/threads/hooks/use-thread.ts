// apps/web/src/components/threads/hooks/use-thread.ts

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { type ThreadMeta, useThreadStore } from '../store'

interface UseThreadOptions {
  /** Thread ID to fetch */
  threadId: string | null | undefined
  /** Enable/disable the hook */
  enabled?: boolean
}

interface UseThreadResult {
  /** The thread from cache */
  thread: ThreadMeta | undefined
  /** Loading state (pending or fetching) */
  isLoading: boolean
  /** Data came from cache */
  isCached: boolean
  /** Thread was not found */
  isNotFound: boolean
}

/**
 * Hook to get a single thread by ID.
 * Queues fetch via batching if not in cache.
 *
 * @example
 * const { thread, isLoading } = useThread({ threadId: 'abc123' })
 */
export function useThread({ threadId, enabled = true }: UseThreadOptions): UseThreadResult {
  // Subscribe to thread (primitive selector)
  const thread = useThreadStore(
    useCallback((state) => (threadId ? state.threads.get(threadId) : undefined), [threadId])
  )

  // Subscribe to loading state
  const isLoading = useThreadStore(
    useCallback((state) => (threadId ? state.isThreadLoading(threadId) : false), [threadId])
  )

  // Subscribe to not found state
  const isNotFound = useThreadStore(
    useCallback((state) => (threadId ? state.notFoundIds.has(threadId) : false), [threadId])
  )

  // Track requested IDs to prevent duplicate requests
  const requestedRef = useRef<Set<string>>(new Set())

  // Get request action (stable reference)
  const requestThread = useThreadStore((s) => s.requestThread)

  // Request fetch in useLayoutEffect - runs synchronously before paint
  useLayoutEffect(() => {
    console.log('[thread-load] useThread layoutEffect', {
      threadId,
      enabled,
      hasThread: !!thread,
      alreadyRequested: threadId ? requestedRef.current.has(threadId) : false,
    })
    if (!enabled || !threadId) return
    if (thread) return
    if (requestedRef.current.has(threadId)) return

    requestedRef.current.add(threadId)
    console.log('[thread-load] → requestThread', threadId)
    requestThread(threadId)
  }, [enabled, threadId, thread, requestThread])

  // Clear on threadId change
  // biome-ignore lint/correctness/useExhaustiveDependencies: threadId triggers clearing the requested set
  useEffect(() => {
    requestedRef.current.clear()
  }, [threadId])

  return {
    thread,
    isLoading: !thread && isLoading,
    isCached: !!thread,
    isNotFound,
  }
}

/**
 * Check if a thread is currently being loaded.
 */
export function useIsThreadLoading(threadId: string): boolean {
  return useThreadStore(useCallback((state) => state.isThreadLoading(threadId), [threadId]))
}

/**
 * Check if a thread was not found.
 */
export function useIsThreadNotFound(threadId: string): boolean {
  return useThreadStore(useCallback((state) => state.notFoundIds.has(threadId), [threadId]))
}

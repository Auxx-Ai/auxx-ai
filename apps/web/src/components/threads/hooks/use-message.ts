// apps/web/src/components/threads/hooks/use-message.ts

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useMessageStore, type MessageMeta } from '../store'

interface UseMessageOptions {
  messageId: string | null | undefined
  enabled?: boolean
}

interface UseMessageResult {
  message: MessageMeta | undefined
  isLoading: boolean
  isCached: boolean
  isNotFound: boolean
}

/**
 * Hook to get a single message by ID.
 *
 * @example
 * const { message, isLoading } = useMessage({ messageId: 'msg123' })
 */
export function useMessage({ messageId, enabled = true }: UseMessageOptions): UseMessageResult {
  const message = useMessageStore(
    useCallback((state) => (messageId ? state.messages.get(messageId) : undefined), [messageId])
  )

  const isLoading = useMessageStore(
    useCallback((state) => (messageId ? state.isMessageLoading(messageId) : false), [messageId])
  )

  const isNotFound = useMessageStore(
    useCallback((state) => (messageId ? state.notFoundIds.has(messageId) : false), [messageId])
  )

  const requestedRef = useRef<Set<string>>(new Set())
  const requestMessage = useMessageStore((s) => s.requestMessage)

  useLayoutEffect(() => {
    if (!enabled || !messageId) return
    if (message) return
    if (requestedRef.current.has(messageId)) return

    requestedRef.current.add(messageId)
    requestMessage(messageId)
  }, [enabled, messageId, message, requestMessage])

  useEffect(() => {
    requestedRef.current.clear()
  }, [messageId])

  return {
    message,
    isLoading: !message && isLoading,
    isCached: !!message,
    isNotFound,
  }
}

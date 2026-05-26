// apps/web/src/components/threads/hooks/use-messages.ts

import { extractUniqueParticipantIds } from '@auxx/types'
import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import {
  type MessageMeta,
  useMessageListStore,
  useMessageStore,
  useParticipantStore,
} from '../store'

interface UseMessagesOptions {
  threadId: string | null | undefined
  enabled?: boolean
}

interface UseMessagesResult {
  /** All messages for the thread */
  messages: MessageMeta[]
  /** Message IDs in order */
  messageIds: string[]
  /** Initial load in progress */
  isLoading: boolean
  /** Total message count */
  total: number
  /** Refresh messages */
  refresh: () => void
}

/**
 * Hook to get all messages for a thread.
 * Single API call returns full messages.
 * Automatically triggers participant fetch for display.
 *
 * @example
 * const { messages, isLoading } = useMessages({ threadId: 'thread123' })
 */
export function useMessages({ threadId, enabled = true }: UseMessagesOptions): UseMessagesResult {
  // Get cached message list
  const cachedList = useMessageListStore(
    useCallback((state) => (threadId ? state.lists.get(threadId) : undefined), [threadId])
  )

  const messageIds = cachedList?.messageIds ?? []

  // Get all messages from store (useShallow prevents infinite loops)
  const messages = useMessageStore(
    useShallow((s) =>
      messageIds.map((id) => s.messages.get(id)).filter((m): m is MessageMeta => m !== undefined)
    )
  )

  // Store actions
  const setList = useMessageListStore((s) => s.setList)
  const setMessages = useMessageStore((s) => s.setMessages)
  const requestParticipant = useParticipantStore((s) => s.requestParticipant)

  // Fetch messages for thread (single API call now returns full messages)
  const { data, isLoading, refetch } = api.message.listByThread.useQuery(
    { threadId: threadId! },
    {
      enabled: enabled && !!threadId && !cachedList,
      staleTime: 30_000,
    }
  )

  // Sync to stores and queue participant fetches
  useEffect(() => {
    if (!data || !threadId) return

    // Populate message store. Additive — won't drop optimistic entries that
    // aren't in `data` (e.g. a just-sent message whose mutation `onSuccess`
    // wrote to the store before this effect re-fired from a stale cache).
    setMessages(data.messages)

    // Only seed the list when it hasn't been populated yet. On remount with
    // a warm tRPC cache (e.g. a chat thread's compose instance popping out
    // floating a second time → new `ChatPanelMessages` mount), `data` is
    // synchronously available from queryClient and this effect would
    // otherwise re-run and clobber `appendMessage`/`removeMessage` mutations
    // applied since the original fetch — wiping the just-sent message from
    // both the floating panel and the thread view.
    if (!cachedList) {
      setList(threadId, {
        messageIds: data.messages.map((m) => m.id),
        total: data.total,
        fetchedAt: Date.now(),
      })
    }

    // Extract unique participant IDs and queue fetches
    const allParticipantIds = data.messages.flatMap((m) => m.participants)
    const uniqueIds = extractUniqueParticipantIds(allParticipantIds)
    for (const id of uniqueIds) {
      requestParticipant(id)
    }
  }, [data, threadId, cachedList, setList, setMessages, requestParticipant])

  return {
    messages,
    messageIds,
    isLoading,
    total: cachedList?.total ?? 0,
    refresh: refetch,
  }
}

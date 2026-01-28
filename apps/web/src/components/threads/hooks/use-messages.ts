// apps/web/src/components/threads/hooks/use-messages.ts

import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { extractUniqueParticipantIds } from '@auxx/types'
import { useMessageListStore, useMessageStore, useParticipantStore, type MessageMeta } from '../store'
import { api } from '~/trpc/react'

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

    // Populate message store
    setMessages(data.messages)

    // Populate list store
    setList(threadId, {
      messageIds: data.messages.map((m) => m.id),
      total: data.total,
      fetchedAt: Date.now(),
    })

    // Extract unique participant IDs and queue fetches
    const allParticipantIds = data.messages.flatMap((m) => m.participants)
    const uniqueIds = extractUniqueParticipantIds(allParticipantIds)
    for (const id of uniqueIds) {
      requestParticipant(id)
    }
  }, [data, threadId, setList, setMessages, requestParticipant])

  return {
    messages,
    messageIds,
    isLoading,
    total: cachedList?.total ?? 0,
    refresh: refetch,
  }
}

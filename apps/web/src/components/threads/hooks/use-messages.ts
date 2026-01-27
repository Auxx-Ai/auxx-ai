// apps/web/src/components/threads/hooks/use-messages.ts

import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { useMessageListStore, useMessageStore, type MessageMeta } from '../store'
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
  const requestMessage = useMessageStore((s) => s.requestMessage)

  // Fetch message IDs for thread
  const { data, isLoading, refetch } = api.message.listByThread.useQuery(
    { threadId: threadId! },
    {
      enabled: enabled && !!threadId && !cachedList,
      staleTime: 30_000,
    }
  )

  // Sync to store and queue message fetches
  useEffect(() => {
    if (!data || !threadId) return

    setList(threadId, {
      messageIds: data.ids,
      total: data.total,
      fetchedAt: Date.now(),
    })

    for (const id of data.ids) {
      requestMessage(id)
    }
  }, [data, threadId, setList, requestMessage])

  return {
    messages,
    messageIds,
    isLoading,
    total: cachedList?.total ?? 0,
    refresh: refetch,
  }
}

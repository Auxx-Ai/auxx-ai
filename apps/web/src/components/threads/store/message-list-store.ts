// apps/web/src/components/threads/store/message-list-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Cache entry for messages in a thread.
 */
interface MessageListCache {
  messageIds: string[]
  total: number
  fetchedAt: number
}

/**
 * Message list store state interface.
 */
interface MessageListStoreState {
  /** threadId → message list cache */
  lists: Map<string, MessageListCache>

  setList: (threadId: string, cache: MessageListCache) => void
  appendMessage: (threadId: string, messageId: string) => void
  prependMessage: (threadId: string, messageId: string) => void
  removeMessage: (threadId: string, messageId: string) => void
  invalidate: (threadId: string) => void
  invalidateAll: () => void
}

/**
 * Zustand store for thread → message ID list mapping.
 */
export const useMessageListStore = create<MessageListStoreState>()(
  immer((set) => ({
    lists: new Map(),

    setList: (threadId, cache) =>
      set((state) => {
        state.lists.set(threadId, cache)
      }),

    appendMessage: (threadId, messageId) =>
      set((state) => {
        const list = state.lists.get(threadId)
        if (list && !list.messageIds.includes(messageId)) {
          list.messageIds.push(messageId)
          list.total += 1
        }
      }),

    prependMessage: (threadId, messageId) =>
      set((state) => {
        const list = state.lists.get(threadId)
        if (list && !list.messageIds.includes(messageId)) {
          list.messageIds = [messageId, ...list.messageIds]
          list.total += 1
        }
      }),

    removeMessage: (threadId, messageId) =>
      set((state) => {
        const list = state.lists.get(threadId)
        if (list) {
          list.messageIds = list.messageIds.filter((id) => id !== messageId)
          list.total = Math.max(0, list.total - 1)
        }
      }),

    invalidate: (threadId) =>
      set((state) => {
        state.lists.delete(threadId)
      }),

    invalidateAll: () =>
      set((state) => {
        state.lists.clear()
      }),
  }))
)

/**
 * Get store state outside of React.
 */
export const getMessageListStoreState = () => useMessageListStore.getState()

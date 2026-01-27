// apps/web/src/components/threads/store/thread-list-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Cache entry for a thread list.
 */
interface ThreadListCache {
  ids: string[]
  total: number
  nextCursor: string | null
  fetchedAt: number
}

/**
 * Thread list store state interface.
 */
interface ThreadListStoreState {
  /** Cache by filter key (JSON stringified filter) */
  lists: Record<string, ThreadListCache>

  /** Currently active list key */
  activeListKey: string | null

  // Actions
  setList: (key: string, cache: ThreadListCache) => void
  appendToList: (key: string, ids: string[], nextCursor: string | null) => void
  invalidateList: (key: string) => void
  invalidateAll: () => void
  setActiveListKey: (key: string | null) => void

  // Optimistic updates
  removeThreadFromAllLists: (threadId: string) => void
  prependThreadToList: (key: string, threadId: string) => void
  updateThreadPosition: (key: string, threadId: string, newPosition: number) => void
}

/**
 * Create stable filter key from filter params.
 */
export function createListKey(filter: {
  contextType: string
  contextId?: string
  statusSlug?: string
  searchQuery?: string
  sortBy?: string
  sortDirection?: string
}): string {
  return JSON.stringify(filter, Object.keys(filter).sort())
}

/**
 * Zustand store for thread list caching by filter key.
 */
export const useThreadListStore = create<ThreadListStoreState>()(
  immer((set) => ({
    lists: {},
    activeListKey: null,

    setList: (key, cache) =>
      set((state) => {
        state.lists[key] = cache
      }),

    appendToList: (key, ids, nextCursor) =>
      set((state) => {
        const existing = state.lists[key]
        if (existing) {
          // Dedupe IDs
          const existingSet = new Set(existing.ids)
          const newIds = ids.filter((id) => !existingSet.has(id))
          existing.ids = [...existing.ids, ...newIds]
          existing.nextCursor = nextCursor
        }
      }),

    invalidateList: (key) =>
      set((state) => {
        delete state.lists[key]
      }),

    invalidateAll: () =>
      set((state) => {
        state.lists = {}
      }),

    setActiveListKey: (key) =>
      set((state) => {
        state.activeListKey = key
      }),

    removeThreadFromAllLists: (threadId) =>
      set((state) => {
        for (const list of Object.values(state.lists)) {
          const index = list.ids.indexOf(threadId)
          if (index !== -1) {
            list.ids.splice(index, 1)
            list.total = Math.max(0, list.total - 1)
          }
        }
      }),

    prependThreadToList: (key, threadId) =>
      set((state) => {
        const list = state.lists[key]
        if (list && !list.ids.includes(threadId)) {
          list.ids = [threadId, ...list.ids]
          list.total += 1
        }
      }),

    updateThreadPosition: (key, threadId, newPosition) =>
      set((state) => {
        const list = state.lists[key]
        if (list) {
          const index = list.ids.indexOf(threadId)
          if (index !== -1) {
            list.ids.splice(index, 1)
            list.ids.splice(newPosition, 0, threadId)
          }
        }
      }),
  }))
)

/**
 * Get store state outside of React.
 */
export const getThreadListStoreState = () => useThreadListStore.getState()

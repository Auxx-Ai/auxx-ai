// apps/web/src/components/threads/store/thread-read-status-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Thread read status store state interface.
 */
interface ThreadReadStatusStoreState {
  /** threadId → isUnread */
  status: Map<string, boolean>
  pendingIds: Set<string>
  loadingIds: Set<string>

  setStatus: (threadId: string, isUnread: boolean) => void
  setStatusBatch: (entries: Array<{ threadId: string; isUnread: boolean }>) => void
  requestStatus: (threadId: string) => void
  markAsRead: (threadId: string) => void
  markAsUnread: (threadId: string) => void
  invalidate: (threadId: string) => void
  reset: () => void
}

/**
 * Zustand store for thread read/unread status tracking.
 */
export const useThreadReadStatusStore = create<ThreadReadStatusStoreState>()(
  immer((set, get) => ({
    status: new Map(),
    pendingIds: new Set(),
    loadingIds: new Set(),

    setStatus: (threadId, isUnread) =>
      set((state) => {
        state.status.set(threadId, isUnread)
        state.pendingIds.delete(threadId)
        state.loadingIds.delete(threadId)
      }),

    setStatusBatch: (entries) =>
      set((state) => {
        for (const { threadId, isUnread } of entries) {
          state.status.set(threadId, isUnread)
          state.pendingIds.delete(threadId)
          state.loadingIds.delete(threadId)
        }
      }),

    requestStatus: (threadId) => {
      const state = get()
      if (
        state.status.has(threadId) ||
        state.pendingIds.has(threadId) ||
        state.loadingIds.has(threadId)
      ) {
        return
      }
      set((s) => {
        s.pendingIds.add(threadId)
      })
    },

    markAsRead: (threadId) =>
      set((state) => {
        state.status.set(threadId, false)
      }),

    markAsUnread: (threadId) =>
      set((state) => {
        state.status.set(threadId, true)
      }),

    invalidate: (threadId) =>
      set((state) => {
        state.status.delete(threadId)
      }),

    reset: () =>
      set((state) => {
        state.status.clear()
        state.pendingIds.clear()
        state.loadingIds.clear()
      }),
  }))
)

/**
 * Get store state outside of React.
 */
export const getThreadReadStatusStoreState = () => useThreadReadStatusStore.getState()

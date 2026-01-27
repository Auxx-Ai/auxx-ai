// apps/web/src/components/threads/store/thread-draft-store.ts

import '~/lib/immer-config'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 100

/**
 * Thread draft status store state interface.
 * Tracks which threads have drafts for the current user.
 */
interface ThreadDraftStoreState {
  /** threadId → hasDraft */
  status: Map<string, boolean>
  /** Thread IDs waiting to be batched */
  pendingIds: Set<string>
  /** Thread IDs currently being fetched */
  loadingIds: Set<string>
  /** Batch timer reference */
  batchTimer: ReturnType<typeof setTimeout> | null

  /** Set draft status for a single thread */
  setStatus: (threadId: string, hasDraft: boolean) => void
  /** Set draft status for multiple threads */
  setStatusBatch: (threadIdsWithDrafts: string[], allRequestedIds: string[]) => void
  /** Request draft status for a thread (queues for batch fetch) */
  requestStatus: (threadId: string) => void
  /** Start a batch fetch - returns IDs to fetch and moves them to loading */
  startBatch: () => string[]
  /** Complete a batch fetch */
  completeBatch: (threadIdsWithDrafts: string[], allRequestedIds: string[]) => void
  /** Invalidate draft status for a thread (e.g., after draft created/deleted) */
  invalidate: (threadId: string) => void
  /** Optimistically mark a thread as having a draft */
  markHasDraft: (threadId: string) => void
  /** Optimistically mark a thread as not having a draft */
  markNoDraft: (threadId: string) => void
  /** Reset store state */
  reset: () => void
}

/**
 * Zustand store for thread draft status tracking.
 * Used to show draft indicators in thread list.
 */
export const useThreadDraftStore = create<ThreadDraftStoreState>()(
  immer((set, get) => ({
    status: new Map(),
    pendingIds: new Set(),
    loadingIds: new Set(),
    batchTimer: null,

    setStatus: (threadId, hasDraft) =>
      set((state) => {
        state.status.set(threadId, hasDraft)
        state.pendingIds.delete(threadId)
        state.loadingIds.delete(threadId)
      }),

    setStatusBatch: (threadIdsWithDrafts, allRequestedIds) =>
      set((state) => {
        const withDraftsSet = new Set(threadIdsWithDrafts)
        for (const threadId of allRequestedIds) {
          state.status.set(threadId, withDraftsSet.has(threadId))
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

      // Start timer for batch processing
      if (!state.batchTimer) {
        const timer = setTimeout(() => {
          set((s) => {
            s.batchTimer = null
          })
        }, BATCH_DELAY)
        set((s) => {
          s.batchTimer = timer
        })
      }
    },

    startBatch: () => {
      const state = get()
      const batch = Array.from(state.pendingIds).slice(0, MAX_BATCH_SIZE)

      set((s) => {
        for (const id of batch) {
          s.pendingIds.delete(id)
          s.loadingIds.add(id)
        }
      })

      return batch
    },

    completeBatch: (threadIdsWithDrafts, allRequestedIds) =>
      set((state) => {
        const withDraftsSet = new Set(threadIdsWithDrafts)
        for (const threadId of allRequestedIds) {
          state.status.set(threadId, withDraftsSet.has(threadId))
          state.loadingIds.delete(threadId)
        }
      }),

    invalidate: (threadId) =>
      set((state) => {
        state.status.delete(threadId)
      }),

    markHasDraft: (threadId) =>
      set((state) => {
        state.status.set(threadId, true)
      }),

    markNoDraft: (threadId) =>
      set((state) => {
        state.status.set(threadId, false)
      }),

    reset: () => {
      const timer = get().batchTimer
      if (timer) clearTimeout(timer)

      set((state) => {
        state.status.clear()
        state.pendingIds.clear()
        state.loadingIds.clear()
        state.batchTimer = null
      })
    },
  }))
)

/**
 * Get store state outside of React.
 */
export const getThreadDraftStoreState = () => useThreadDraftStore.getState()

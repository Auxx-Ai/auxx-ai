// apps/web/src/components/threads/store/thread-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 100

/** Thread status enum */
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'

/** Integration provider enum */
export type IntegrationProvider = 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE'

/** Actor ID with type discriminator (matches backend) */
export interface ActorId {
  type: 'user' | 'contact'
  id: string
}

/** Tag summary for display in thread list */
export interface ThreadTagSummary {
  id: string
  title: string
  color?: string | null
  emoji?: string | null
}

/**
 * ThreadMeta - core thread metadata for display.
 * Matches the backend ThreadMeta type from packages/lib/src/threads/types.ts
 */
export interface ThreadMeta {
  id: string
  subject: string
  status: ThreadStatus
  lastMessageAt: string // ISO date
  firstMessageAt: string | null
  messageCount: number
  participantCount: number

  // Foreign keys (IDs only - frontend resolves via separate stores)
  integrationId: string
  integrationProvider: IntegrationProvider | null
  assigneeActorId: ActorId | null

  // Denormalized for performance (avoid extra fetches for list display)
  latestMessageId: string | null
  latestCommentId: string | null

  // Inbox association
  inboxId: string | null

  // External ID for chat threads (e.g., Facebook conversation ID)
  externalId: string | null

  // Tags included inline for list display
  tags: ThreadTagSummary[]

  // Read status for the requesting user
  isUnread: boolean
}

/**
 * Thread store state interface.
 */
interface ThreadStoreState {
  // Cache
  threads: Map<string, ThreadMeta>

  // Loading states
  pendingIds: Set<string>
  loadingIds: Set<string>
  notFoundIds: Set<string>

  // Batch timer
  batchTimer: ReturnType<typeof setTimeout> | null

  // Actions
  setThreads: (threads: ThreadMeta[]) => void
  updateThread: (id: string, updates: Partial<ThreadMeta>) => void
  removeThread: (id: string) => void

  // Lazy loading
  requestThread: (id: string) => void
  startBatch: () => string[]
  completeBatch: (threads: ThreadMeta[], notFoundIds: string[]) => void

  // Selectors (for use outside React)
  getThread: (id: string) => ThreadMeta | undefined
  isThreadLoading: (id: string) => boolean

  reset: () => void
}

/**
 * Zustand store for thread metadata caching and batched lazy-loading.
 */
export const useThreadStore = create<ThreadStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      threads: new Map(),
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,

      setThreads: (threads) =>
        set((state) => {
          for (const thread of threads) {
            state.threads.set(thread.id, thread)
            state.pendingIds.delete(thread.id)
            state.loadingIds.delete(thread.id)
            state.notFoundIds.delete(thread.id)
          }
        }),

      updateThread: (id, updates) =>
        set((state) => {
          const existing = state.threads.get(id)
          if (existing) {
            state.threads.set(id, { ...existing, ...updates })
          }
        }),

      removeThread: (id) =>
        set((state) => {
          state.threads.delete(id)
        }),

      requestThread: (id) => {
        const state = get()
        if (
          state.threads.has(id) ||
          state.loadingIds.has(id) ||
          state.pendingIds.has(id) ||
          state.notFoundIds.has(id)
        ) {
          return
        }

        set((s) => {
          s.pendingIds.add(id)
        })

        // Timer triggers provider to fetch
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

      completeBatch: (threads, notFoundIds) =>
        set((state) => {
          for (const thread of threads) {
            state.threads.set(thread.id, thread)
            state.loadingIds.delete(thread.id)
          }
          for (const id of notFoundIds) {
            state.loadingIds.delete(id)
            state.notFoundIds.add(id)
          }
        }),

      getThread: (id) => get().threads.get(id),

      isThreadLoading: (id) => get().loadingIds.has(id) || get().pendingIds.has(id),

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        set((state) => {
          state.threads.clear()
          state.pendingIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.batchTimer = null
        })
      },
    }))
  )
)

/**
 * Get store state outside of React.
 */
export const getThreadStoreState = () => useThreadStore.getState()

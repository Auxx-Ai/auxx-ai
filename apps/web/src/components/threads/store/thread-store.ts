// apps/web/src/components/threads/store/thread-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ThreadClientFilter } from '@auxx/lib/mail-query/client'
import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'

/** Re-export filter type for convenience */
export type { ThreadClientFilter as ThreadFilter }

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 100

/** Thread status enum */
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'

/** Integration provider enum */
export type IntegrationProvider = 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE'

/** Actor ID with type discriminator (matches backend) */

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
  assigneeId: ActorId | null

  // Denormalized for performance (avoid extra fetches for list display)
  latestMessageId: string | null
  latestCommentId: string | null

  /** Inbox RecordId (format: "entityDefinitionId:instanceId") or null if unassigned */
  inboxId: RecordId | null

  // External ID for chat threads (e.g., Facebook conversation ID)
  externalId: string | null

  /** Tag RecordIds (format: "entityDefinitionId:instanceId") */
  tagIds: RecordId[]

  // Read status for the requesting user
  isUnread: boolean

  /** Draft RecordIds for the requesting user on this thread (format: "draft:draftId") */
  draftIds: RecordId[]
}

/** Sorting options for thread lists */
export interface ThreadSort {
  field: 'lastMessageAt' | 'firstMessageAt' | 'subject'
  direction: 'asc' | 'desc'
}

/** Pagination info for loaded contexts */
export interface ContextPagination {
  cursor: string | null
  hasMore: boolean
  total: number
}

/** Pending mutation tracking for safe concurrent rollback */
interface PendingMutation {
  changes: Partial<ThreadMeta> // What this mutation optimistically applied
  previous: Partial<ThreadMeta> // Previous values for those keys (for rollback)
}

/**
 * Thread store state interface.
 */
interface ThreadStoreState {
  // ═══════════════════════════════════════════════════════════════
  // CORE STATE
  // ═══════════════════════════════════════════════════════════════

  /** All loaded threads */
  threads: Map<string, ThreadMeta>

  /** Contexts that have been fully loaded (for pagination tracking) */
  loadedContexts: Map<string, ContextPagination>

  // ═══════════════════════════════════════════════════════════════
  // OPTIMISTIC UPDATE STATE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pending mutations tracked per thread, per version.
   * Each mutation stores only the keys it changed and their previous values.
   * This allows concurrent mutations on different fields to coexist safely.
   */
  pendingMutations: Map<string, Map<number, PendingMutation>>

  /** Mutation version counter per thread (for race condition handling) */
  mutationVersions: Map<string, number>

  // ═══════════════════════════════════════════════════════════════
  // BATCH LOADING STATE
  // ═══════════════════════════════════════════════════════════════

  pendingIds: Set<string>
  loadingIds: Set<string>
  notFoundIds: Set<string>
  batchTimer: ReturnType<typeof setTimeout> | null

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════

  // Thread CRUD
  setThreads: (threads: ThreadMeta[]) => void
  updateThread: (id: string, updates: Partial<ThreadMeta>) => void
  removeThread: (id: string) => void

  // Optimistic updates (version-tracked for concurrent mutation safety)
  updateThreadOptimistic: (id: string, updates: Partial<ThreadMeta>) => number
  confirmOptimistic: (id: string, version: number) => void
  rollbackOptimistic: (id: string, version: number) => void
  getMutationVersion: (id: string) => number

  // Context tracking
  setContextLoaded: (
    contextKey: string,
    cursor: string | null,
    hasMore: boolean,
    total: number
  ) => void
  isContextLoaded: (contextKey: string) => boolean
  getContextPagination: (contextKey: string) => ContextPagination | undefined
  invalidateContext: (contextKey: string) => void
  invalidateAllContexts: () => void

  // Batch loading
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
 * Supports derived views and optimistic updates.
 */
export const useThreadStore = create<ThreadStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // ═══════════════════════════════════════════════════════════════
      // CORE STATE
      // ═══════════════════════════════════════════════════════════════
      threads: new Map(),
      loadedContexts: new Map(),

      // ═══════════════════════════════════════════════════════════════
      // OPTIMISTIC UPDATE STATE
      // ═══════════════════════════════════════════════════════════════
      pendingMutations: new Map(),
      mutationVersions: new Map(),

      // ═══════════════════════════════════════════════════════════════
      // BATCH LOADING STATE
      // ═══════════════════════════════════════════════════════════════
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,

      // ═══════════════════════════════════════════════════════════════
      // THREAD CRUD ACTIONS
      // ═══════════════════════════════════════════════════════════════

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

      // ═══════════════════════════════════════════════════════════════
      // OPTIMISTIC UPDATE ACTIONS
      // ═══════════════════════════════════════════════════════════════

      /**
       * Apply optimistic update with delta tracking.
       * Returns version number to pass to confirm/rollback.
       */
      updateThreadOptimistic: (id, updates) => {
        let version = 0
        set((state) => {
          const existing = state.threads.get(id)
          if (!existing) return

          // Increment version for this thread
          version = (state.mutationVersions.get(id) ?? 0) + 1
          state.mutationVersions.set(id, version)

          // Capture previous values for ONLY the keys we're changing
          // This allows rollback to only revert this mutation's changes
          const previous: Partial<ThreadMeta> = {}
          for (const key of Object.keys(updates) as (keyof ThreadMeta)[]) {
            previous[key] = existing[key] as any
          }

          // Initialize nested map if needed
          if (!state.pendingMutations.has(id)) {
            state.pendingMutations.set(id, new Map())
          }

          // Store this mutation's delta (keyed by version)
          state.pendingMutations.get(id)!.set(version, {
            changes: { ...updates },
            previous,
          })

          // Apply optimistic update
          state.threads.set(id, { ...existing, ...updates })
        })
        return version
      },

      /**
       * Confirm a specific mutation succeeded.
       * Removes it from pending tracking.
       */
      confirmOptimistic: (id, version) =>
        set((state) => {
          const mutations = state.pendingMutations.get(id)
          if (mutations) {
            mutations.delete(version)
            if (mutations.size === 0) {
              state.pendingMutations.delete(id)
            }
          }
        }),

      /**
       * Rollback a specific mutation that failed.
       * Only reverts the keys that mutation changed.
       * Handles concurrent mutations safely by checking for newer pending mutations.
       */
      rollbackOptimistic: (id, version) =>
        set((state) => {
          const mutations = state.pendingMutations.get(id)
          const mutation = mutations?.get(version)
          if (!mutation) return

          const thread = state.threads.get(id)
          if (thread) {
            // Check if newer mutations are pending for the SAME keys
            // If so, don't rollback those keys (let newer mutation handle it)
            const keysToRollback = Object.keys(mutation.previous) as (keyof ThreadMeta)[]
            const safeToRollback: Partial<ThreadMeta> = {}

            for (const key of keysToRollback) {
              const hasNewerMutationForKey = Array.from(mutations?.values() ?? []).some(
                (m) => m !== mutation && Object.keys(m.changes).includes(key)
              )
              if (!hasNewerMutationForKey) {
                safeToRollback[key] = mutation.previous[key] as any
              }
            }

            // Apply rollback for safe keys only
            if (Object.keys(safeToRollback).length > 0) {
              state.threads.set(id, { ...thread, ...safeToRollback })
            }
          }

          // Always clean up this mutation from pending
          mutations?.delete(version)
          if (mutations?.size === 0) {
            state.pendingMutations.delete(id)
          }
        }),

      getMutationVersion: (id) => get().mutationVersions.get(id) ?? 0,

      // ═══════════════════════════════════════════════════════════════
      // CONTEXT TRACKING ACTIONS
      // ═══════════════════════════════════════════════════════════════

      setContextLoaded: (key, cursor, hasMore, total) =>
        set((state) => {
          state.loadedContexts.set(key, { cursor, hasMore, total })
        }),

      isContextLoaded: (key) => get().loadedContexts.has(key),

      getContextPagination: (key) => get().loadedContexts.get(key),

      invalidateContext: (key) =>
        set((state) => {
          state.loadedContexts.delete(key)
        }),

      invalidateAllContexts: () =>
        set((state) => {
          state.loadedContexts.clear()
        }),

      // ═══════════════════════════════════════════════════════════════
      // BATCH LOADING ACTIONS
      // ═══════════════════════════════════════════════════════════════

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

      // ═══════════════════════════════════════════════════════════════
      // SELECTORS
      // ═══════════════════════════════════════════════════════════════

      getThread: (id) => get().threads.get(id),

      isThreadLoading: (id) => get().loadingIds.has(id) || get().pendingIds.has(id),

      // ═══════════════════════════════════════════════════════════════
      // RESET
      // ═══════════════════════════════════════════════════════════════

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        set((state) => {
          state.threads.clear()
          state.loadedContexts.clear()
          state.pendingMutations.clear()
          state.mutationVersions.clear()
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

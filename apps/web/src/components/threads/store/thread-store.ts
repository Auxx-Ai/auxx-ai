// apps/web/src/components/threads/store/thread-store.ts

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { ThreadClientFilter } from '@auxx/lib/mail-query/client'
import type { ActorId } from '@auxx/types/actor'
import type { StandaloneDraftMeta } from '@auxx/types/draft'
import type { RecordId } from '@auxx/types/resource'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/** Re-export filter type for convenience */
export type { ThreadClientFilter as ThreadFilter }

/** Re-export standalone draft meta for convenience */
export type { StandaloneDraftMeta }

/** Batching configuration */
const BATCH_DELAY = 50
const MAX_BATCH_SIZE = 100

/** Thread status enum */
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'

/** Integration provider enum */
export type ChannelProvider = 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE'

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
  integrationProvider: ChannelProvider | null
  /** True when the integration is a seeded placeholder — blocks reply in the UI. */
  integrationIsExample: boolean
  assigneeId: ActorId | null

  // Denormalized for performance (avoid extra fetches for list display)
  latestMessageId: string | null
  latestCommentId: string | null

  /** Inbox RecordId (format: "entityDefinitionId:instanceId") or null if unassigned */
  inboxId: RecordId | null

  /** Ticket EntityInstance ID this thread is linked to, or null */
  ticketId: RecordId | null

  // External ID for chat threads (e.g., Facebook conversation ID)
  externalId: string | null

  /** Tag RecordIds (format: "entityDefinitionId:instanceId") */
  tagIds: RecordId[]

  // Read status for the requesting user
  isUnread: boolean

  /** Draft RecordIds for the requesting user on this thread (format: "draft:draftId") */
  draftIds: RecordId[]

  /** Number of pending scheduled messages on this thread */
  scheduledMessageCount: number
}

/** Scheduled message metadata for display in thread conversation view */
export interface ScheduledMessageMeta {
  id: string
  threadId: string | null
  draftId: string | null
  scheduledAt: string // ISO date
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'
  createdById: string
  sendPayload: Record<string, unknown>
  createdAt: string
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
  // BATCH LOADING STATE (THREADS)
  // ═══════════════════════════════════════════════════════════════

  pendingIds: Set<string>
  loadingIds: Set<string>
  notFoundIds: Set<string>
  batchTimer: ReturnType<typeof setTimeout> | null

  // ═══════════════════════════════════════════════════════════════
  // SCHEDULED MESSAGE STATE
  // ═══════════════════════════════════════════════════════════════

  /** All loaded scheduled messages (keyed by scheduled message ID) */
  scheduledMessages: Map<string, ScheduledMessageMeta>

  // ═══════════════════════════════════════════════════════════════
  // STANDALONE DRAFT STATE
  // ═══════════════════════════════════════════════════════════════

  /** All loaded standalone drafts */
  standaloneDrafts: Map<string, StandaloneDraftMeta>

  /** Pending draft IDs to fetch */
  pendingDraftIds: Set<string>

  /** Draft IDs currently being loaded */
  loadingDraftIds: Set<string>

  /** Draft IDs that were not found */
  notFoundDraftIds: Set<string>

  /** Timer for draft batch loading */
  draftBatchTimer: ReturnType<typeof setTimeout> | null

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

  // Batch loading (threads)
  requestThread: (id: string) => void
  startBatch: () => string[]
  completeBatch: (threads: ThreadMeta[], notFoundIds: string[]) => void

  // Scheduled message CRUD
  setScheduledMessages: (messages: ScheduledMessageMeta[]) => void
  removeScheduledMessage: (id: string) => void
  getScheduledMessagesForThread: (threadId: string) => ScheduledMessageMeta[]

  // Standalone draft CRUD
  setDrafts: (drafts: StandaloneDraftMeta[]) => void
  updateDraft: (id: string, updates: Partial<StandaloneDraftMeta>) => void
  removeDraft: (id: string) => void

  // Batch loading (drafts)
  requestDraft: (id: string) => void
  startDraftBatch: () => string[]
  completeDraftBatch: (drafts: StandaloneDraftMeta[], notFoundIds: string[]) => void

  /** Mark a draft as not-found (tombstone) so useReplyBox skips fetch */
  markDraftNotFound: (id: string) => void

  // Selectors (for use outside React)
  getThread: (id: string) => ThreadMeta | undefined
  getDraft: (id: string) => StandaloneDraftMeta | undefined
  isThreadLoading: (id: string) => boolean
  isDraftLoading: (id: string) => boolean

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
      // BATCH LOADING STATE (THREADS)
      // ═══════════════════════════════════════════════════════════════
      pendingIds: new Set(),
      loadingIds: new Set(),
      notFoundIds: new Set(),
      batchTimer: null,

      // ═══════════════════════════════════════════════════════════════
      // SCHEDULED MESSAGE STATE
      // ═══════════════════════════════════════════════════════════════
      scheduledMessages: new Map(),

      // ═══════════════════════════════════════════════════════════════
      // STANDALONE DRAFT STATE
      // ═══════════════════════════════════════════════════════════════
      standaloneDrafts: new Map(),
      pendingDraftIds: new Set(),
      loadingDraftIds: new Set(),
      notFoundDraftIds: new Set(),
      draftBatchTimer: null,

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
      // SCHEDULED MESSAGE ACTIONS
      // ═══════════════════════════════════════════════════════════════

      setScheduledMessages: (messages) =>
        set((state) => {
          // Clear existing messages for the same thread(s) being updated
          const threadIds = new Set(messages.map((m) => m.threadId).filter(Boolean))
          if (threadIds.size > 0) {
            for (const [id, msg] of state.scheduledMessages) {
              if (msg.threadId && threadIds.has(msg.threadId)) {
                state.scheduledMessages.delete(id)
              }
            }
          }
          for (const message of messages) {
            state.scheduledMessages.set(message.id, message)
          }
        }),

      removeScheduledMessage: (id) =>
        set((state) => {
          state.scheduledMessages.delete(id)
        }),

      getScheduledMessagesForThread: (threadId) => {
        const messages: ScheduledMessageMeta[] = []
        for (const msg of get().scheduledMessages.values()) {
          if (
            msg.threadId === threadId &&
            (msg.status === 'PENDING' || msg.status === 'PROCESSING')
          ) {
            messages.push(msg)
          }
        }
        return messages
      },

      // ═══════════════════════════════════════════════════════════════
      // STANDALONE DRAFT CRUD ACTIONS
      // ═══════════════════════════════════════════════════════════════

      setDrafts: (drafts) =>
        set((state) => {
          for (const draft of drafts) {
            state.standaloneDrafts.set(draft.id, draft)
            state.pendingDraftIds.delete(draft.id)
            state.loadingDraftIds.delete(draft.id)
            state.notFoundDraftIds.delete(draft.id)
          }
        }),

      updateDraft: (id, updates) =>
        set((state) => {
          const existing = state.standaloneDrafts.get(id)
          if (existing) {
            state.standaloneDrafts.set(id, { ...existing, ...updates })
          }
        }),

      removeDraft: (id) =>
        set((state) => {
          state.standaloneDrafts.delete(id)
          state.pendingDraftIds.delete(id)
          state.loadingDraftIds.delete(id)
          state.notFoundDraftIds.delete(id)
        }),

      // ═══════════════════════════════════════════════════════════════
      // DRAFT BATCH LOADING ACTIONS
      // ═══════════════════════════════════════════════════════════════

      requestDraft: (id) => {
        const state = get()
        if (
          state.standaloneDrafts.has(id) ||
          state.loadingDraftIds.has(id) ||
          state.pendingDraftIds.has(id) ||
          state.notFoundDraftIds.has(id)
        ) {
          return
        }

        set((s) => {
          s.pendingDraftIds.add(id)
        })

        // Timer triggers provider to fetch
        if (!state.draftBatchTimer) {
          const timer = setTimeout(() => {
            set((s) => {
              s.draftBatchTimer = null
            })
          }, BATCH_DELAY)
          set((s) => {
            s.draftBatchTimer = timer
          })
        }
      },

      startDraftBatch: () => {
        const state = get()
        const batch = Array.from(state.pendingDraftIds).slice(0, MAX_BATCH_SIZE)

        set((s) => {
          for (const id of batch) {
            s.pendingDraftIds.delete(id)
            s.loadingDraftIds.add(id)
          }
        })

        return batch
      },

      completeDraftBatch: (drafts, notFoundIds) =>
        set((state) => {
          for (const draft of drafts) {
            state.standaloneDrafts.set(draft.id, draft)
            state.loadingDraftIds.delete(draft.id)
          }
          for (const id of notFoundIds) {
            state.loadingDraftIds.delete(id)
            state.notFoundDraftIds.add(id)
          }
        }),

      markDraftNotFound: (id) =>
        set((state) => {
          state.notFoundDraftIds.add(id)
          state.pendingDraftIds.delete(id)
          state.loadingDraftIds.delete(id)
          state.standaloneDrafts.delete(id)
        }),

      // ═══════════════════════════════════════════════════════════════
      // SELECTORS
      // ═══════════════════════════════════════════════════════════════

      getThread: (id) => get().threads.get(id),

      getDraft: (id) => get().standaloneDrafts.get(id),

      isThreadLoading: (id) => get().loadingIds.has(id) || get().pendingIds.has(id),

      isDraftLoading: (id) => get().loadingDraftIds.has(id) || get().pendingDraftIds.has(id),

      // ═══════════════════════════════════════════════════════════════
      // RESET
      // ═══════════════════════════════════════════════════════════════

      reset: () => {
        const timer = get().batchTimer
        if (timer) clearTimeout(timer)

        const draftTimer = get().draftBatchTimer
        if (draftTimer) clearTimeout(draftTimer)

        set((state) => {
          state.threads.clear()
          state.loadedContexts.clear()
          state.pendingMutations.clear()
          state.mutationVersions.clear()
          state.pendingIds.clear()
          state.loadingIds.clear()
          state.notFoundIds.clear()
          state.batchTimer = null

          // Clear scheduled message state
          state.scheduledMessages.clear()

          // Clear draft state
          state.standaloneDrafts.clear()
          state.pendingDraftIds.clear()
          state.loadingDraftIds.clear()
          state.notFoundDraftIds.clear()
          state.draftBatchTimer = null
        })
      },
    }))
  )
)

/**
 * Get store state outside of React.
 */
export const getThreadStoreState = () => useThreadStore.getState()

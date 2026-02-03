// apps/web/src/components/mail/store/mail-counts-store.ts
'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { FullCountsResponse } from '@auxx/lib/threads/types'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Count values for mail sidebar.
 */
interface MailCounts {
  /** Personal inbox unread (assigned to me, OPEN) */
  inbox: number
  /** All drafts count */
  drafts: number
  /** Shared inbox counts keyed by inboxId */
  sharedInboxes: Record<string, number>
  /** View counts keyed by viewId */
  views: Record<string, number>
}

/**
 * Batch update structure for multiple count changes at once.
 */
export interface CountUpdates {
  inbox?: number
  drafts?: number
  sharedInboxes?: Record<string, number> // inboxId -> delta
  views?: Record<string, number> // viewId -> delta
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

interface MailCountsState {
  /** Count values */
  counts: MailCounts

  /** Loading states */
  isInitialLoading: boolean
  lastFetchedAt: Date | null

  /** Snapshot for rollback */
  _previousCounts: MailCounts | null

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  /** Set counts from server response */
  setCounts: (data: FullCountsResponse) => void

  /** Optimistic update actions (all clamp to 0 minimum) */
  decrementInbox: (amount?: number) => void
  incrementInbox: (amount?: number) => void
  decrementDrafts: (amount?: number) => void
  incrementDrafts: (amount?: number) => void
  updateSharedInbox: (inboxId: string, delta: number) => void
  updateView: (viewId: string, delta: number) => void

  /** Batch update for complex operations */
  batchUpdate: (updates: CountUpdates) => void

  /** Rollback support */
  saveSnapshot: () => void
  restoreSnapshot: () => void

  /** Reset store */
  reset: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════════

const initialCounts: MailCounts = {
  inbox: 0,
  drafts: 0,
  sharedInboxes: {},
  views: {},
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

export const useMailCountsStore = create<MailCountsState>()(
  immer((set) => ({
    // Initial state
    counts: { ...initialCounts },
    isInitialLoading: true,
    lastFetchedAt: null,
    _previousCounts: null,

    // ─────────────────────────────────────────────────────────────────────
    // Set counts from server
    // ─────────────────────────────────────────────────────────────────────

    setCounts: (data) =>
      set((state) => {
        state.counts = {
          inbox: data.inbox,
          drafts: data.drafts,
          sharedInboxes: { ...data.sharedInboxes },
          views: { ...data.views },
        }
        state.isInitialLoading = false
        state.lastFetchedAt = new Date()
      }),

    // ─────────────────────────────────────────────────────────────────────
    // Optimistic update actions (all clamp to 0)
    // ─────────────────────────────────────────────────────────────────────

    decrementInbox: (amount = 1) =>
      set((state) => {
        state.counts.inbox = Math.max(0, state.counts.inbox - amount)
      }),

    incrementInbox: (amount = 1) =>
      set((state) => {
        state.counts.inbox = state.counts.inbox + amount
      }),

    decrementDrafts: (amount = 1) =>
      set((state) => {
        state.counts.drafts = Math.max(0, state.counts.drafts - amount)
      }),

    incrementDrafts: (amount = 1) =>
      set((state) => {
        state.counts.drafts = state.counts.drafts + amount
      }),

    updateSharedInbox: (inboxId, delta) =>
      set((state) => {
        const current = state.counts.sharedInboxes[inboxId] ?? 0
        state.counts.sharedInboxes[inboxId] = Math.max(0, current + delta)
      }),

    updateView: (viewId, delta) =>
      set((state) => {
        const current = state.counts.views[viewId] ?? 0
        state.counts.views[viewId] = Math.max(0, current + delta)
      }),

    // ─────────────────────────────────────────────────────────────────────
    // Batch update for complex operations
    // ─────────────────────────────────────────────────────────────────────

    batchUpdate: (updates) =>
      set((state) => {
        // Update inbox
        if (updates.inbox !== undefined) {
          state.counts.inbox = Math.max(0, state.counts.inbox + updates.inbox)
        }

        // Update drafts
        if (updates.drafts !== undefined) {
          state.counts.drafts = Math.max(0, state.counts.drafts + updates.drafts)
        }

        // Update shared inboxes
        if (updates.sharedInboxes) {
          for (const [inboxId, delta] of Object.entries(updates.sharedInboxes)) {
            const current = state.counts.sharedInboxes[inboxId] ?? 0
            state.counts.sharedInboxes[inboxId] = Math.max(0, current + delta)
          }
        }

        // Update views
        if (updates.views) {
          for (const [viewId, delta] of Object.entries(updates.views)) {
            const current = state.counts.views[viewId] ?? 0
            state.counts.views[viewId] = Math.max(0, current + delta)
          }
        }
      }),

    // ─────────────────────────────────────────────────────────────────────
    // Snapshot for rollback
    // ─────────────────────────────────────────────────────────────────────

    saveSnapshot: () =>
      set((state) => {
        state._previousCounts = {
          inbox: state.counts.inbox,
          drafts: state.counts.drafts,
          sharedInboxes: { ...state.counts.sharedInboxes },
          views: { ...state.counts.views },
        }
      }),

    restoreSnapshot: () =>
      set((state) => {
        if (state._previousCounts) {
          state.counts = { ...state._previousCounts }
          state._previousCounts = null
        }
      }),

    // ─────────────────────────────────────────────────────────────────────
    // Reset
    // ─────────────────────────────────────────────────────────────────────

    reset: () =>
      set((state) => {
        state.counts = { ...initialCounts }
        state.isInitialLoading = true
        state.lastFetchedAt = null
        state._previousCounts = null
      }),
  }))
)

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get total count for all shared inboxes combined.
 * Use this for the "Shared Inboxes" header badge.
 */
export const selectSharedInboxesTotal = (state: MailCountsState): number => {
  return Object.values(state.counts.sharedInboxes).reduce((sum, count) => sum + count, 0)
}

/**
 * Get count for a specific shared inbox.
 */
export const selectSharedInboxCount = (state: MailCountsState, inboxId: string): number => {
  return state.counts.sharedInboxes[inboxId] ?? 0
}

/**
 * Get count for a specific view.
 */
export const selectViewCount = (state: MailCountsState, viewId: string): number => {
  return state.counts.views[viewId] ?? 0
}

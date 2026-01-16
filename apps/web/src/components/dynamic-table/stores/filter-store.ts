// apps/web/src/components/dynamic-table/stores/filter-store.ts
'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

// ============================================================================
// TYPES
// ============================================================================

/** Stable empty array to avoid infinite loops */
const EMPTY_FILTERS: ConditionGroup[] = []

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface FilterStore {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** View filters keyed by viewId (saved to DB) */
  viewFilters: Record<string, ConditionGroup[]>

  /** Session filters keyed by tableId (not saved to DB) */
  sessionFilters: Record<string, ConditionGroup[]>

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set filters for a view */
  setViewFilters: (viewId: string, filters: ConditionGroup[]) => void

  /** Set filters for a session (no view selected) */
  setSessionFilters: (tableId: string, filters: ConditionGroup[]) => void

  /** Clear session filters */
  clearSessionFilters: (tableId: string) => void

  /** Get filters for a view */
  getViewFilters: (viewId: string) => ConditionGroup[]

  /** Get filters for a session */
  getSessionFilters: (tableId: string) => ConditionGroup[]

  /** Get active filters based on current context (view or session) */
  getActiveFilters: (tableId: string, viewId: string | null) => ConditionGroup[]

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /** Clear all state (on logout/org switch) */
  clearAll: () => void
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useFilterStore = create<FilterStore>()(
  subscribeWithSelector((set, get) => ({
    // ─── INITIAL STATE ─────────────────────────────────────────────────────────
    viewFilters: {},
    sessionFilters: {},

    // ─── ACTIONS ───────────────────────────────────────────────────────────────
    setViewFilters: (viewId, filters) => {
      set((state) => ({
        viewFilters: { ...state.viewFilters, [viewId]: filters },
      }))
    },

    setSessionFilters: (tableId, filters) => {
      set((state) => ({
        sessionFilters: { ...state.sessionFilters, [tableId]: filters },
      }))
    },

    clearSessionFilters: (tableId) => {
      set((state) => {
        const { [tableId]: _, ...rest } = state.sessionFilters
        return { sessionFilters: rest }
      })
    },

    getViewFilters: (viewId) => {
      return get().viewFilters[viewId] ?? EMPTY_FILTERS
    },

    getSessionFilters: (tableId) => {
      return get().sessionFilters[tableId] ?? EMPTY_FILTERS
    },

    getActiveFilters: (tableId, viewId) => {
      const state = get()
      if (viewId) {
        return state.viewFilters[viewId] ?? EMPTY_FILTERS
      }
      return state.sessionFilters[tableId] ?? EMPTY_FILTERS
    },

    // ─── CLEANUP ───────────────────────────────────────────────────────────────
    clearAll: () => {
      set({
        viewFilters: {},
        sessionFilters: {},
      })
    },
  }))
)

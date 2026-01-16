// apps/web/src/components/dynamic-table/stores/table-ui-store.ts
'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { deepMerge } from '@auxx/utils'
import type {
  SortingState,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
  ColumnPinningState,
} from '@tanstack/react-table'
import type { ColumnFormatting, KanbanViewConfig, ViewType } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/** UI configuration for a table view (everything EXCEPT filters) */
export interface TableUIConfig {
  sorting: SortingState
  columnVisibility: VisibilityState
  columnOrder: ColumnOrderState
  columnSizing: ColumnSizingState
  columnPinning?: ColumnPinningState
  columnLabels?: Record<string, string>
  columnFormatting?: Record<string, ColumnFormatting>
  rowHeight?: 'compact' | 'normal' | 'spacious'
  viewType?: ViewType
  kanban?: KanbanViewConfig
}

/** Default UI config */
const DEFAULT_UI_CONFIG: TableUIConfig = {
  sorting: [],
  columnVisibility: {},
  columnOrder: [],
  columnSizing: {},
  viewType: 'table',
}

/** Stable empty constants to prevent unnecessary re-renders */
const EMPTY_COLUMN_LABELS: Record<string, string> = {}
const EMPTY_COLUMN_FORMATTING: Record<string, ColumnFormatting> = {}
const EMPTY_SORTING: SortingState = []
const EMPTY_COLUMN_ORDER: ColumnOrderState = []
const EMPTY_COLUMN_VISIBILITY: VisibilityState = {}
const EMPTY_COLUMN_SIZING: ColumnSizingState = {}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface TableUIStore {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Saved configs keyed by viewId (last confirmed server state) */
  viewConfigs: Record<string, TableUIConfig>

  /** Pending (unsaved) config changes per viewId */
  pendingConfigs: Record<string, Partial<TableUIConfig>>

  /** View IDs with unsaved changes */
  dirtyViewIds: Set<string>

  /** Session configs keyed by tableId (when no view is selected) */
  sessionConfigs: Record<string, TableUIConfig>

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW CONFIG ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Update view config (partial, optimistic) */
  updateViewConfig: (viewId: string, changes: Partial<TableUIConfig>) => void

  /** Update kanban-specific config (convenience helper) */
  updateKanbanConfig: (viewId: string, changes: Partial<KanbanViewConfig>) => void

  /** Get saved and pending configs separately (consumers merge in useMemo) */
  getMergedConfig: (viewId: string) => {
    saved: TableUIConfig | null
    pending: Partial<TableUIConfig> | null
  } | null

  /** Reset view to last saved state */
  resetToSaved: (viewId: string) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION CONFIG ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Update session config (when no view is selected) */
  updateSessionConfig: (tableId: string, changes: Partial<TableUIConfig>) => void

  /** Get session config for a table */
  getSessionConfig: (tableId: string) => TableUIConfig

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRTY TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Mark a view as dirty (has pending changes) */
  markDirty: (viewId: string) => void

  /** Mark a view as clean (saved) */
  markClean: (viewId: string) => void

  /** Check if view has unsaved changes */
  isDirty: (viewId: string) => boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Confirm save succeeded - update savedConfigs, clear pending */
  confirmSave: (viewId: string, savedConfig: TableUIConfig) => void

  /** Initialize view config from server */
  setViewConfig: (viewId: string, config: TableUIConfig) => void

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /** Clear all state (on logout/org switch) */
  clearAll: () => void
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useTableUIStore = create<TableUIStore>()(
  subscribeWithSelector((set, get) => ({
    // ─── INITIAL STATE ─────────────────────────────────────────────────────────
    viewConfigs: {},
    pendingConfigs: {},
    dirtyViewIds: new Set(),
    sessionConfigs: {},

    // ─── VIEW CONFIG ACTIONS ───────────────────────────────────────────────────
    updateViewConfig: (viewId, changes) => {
      set((state) => {
        const currentPending = state.pendingConfigs[viewId] ?? {}
        const merged = deepMerge(
          currentPending as Record<string, unknown>,
          changes as Record<string, unknown>
        ) as Partial<TableUIConfig>

        const newDirty = new Set(state.dirtyViewIds)
        newDirty.add(viewId)

        return {
          pendingConfigs: { ...state.pendingConfigs, [viewId]: merged },
          dirtyViewIds: newDirty,
        }
      })
    },

    updateKanbanConfig: (viewId, changes) => {
      const { updateViewConfig, getMergedConfig } = get()
      const configParts = getMergedConfig(viewId)
      if (!configParts) return

      // Merge saved and pending to get current state
      const current =
        configParts.pending && configParts.saved
          ? (deepMerge(
              configParts.saved as Record<string, unknown>,
              configParts.pending as Record<string, unknown>
            ) as TableUIConfig)
          : configParts.saved

      const currentKanban = current?.kanban ?? {}
      updateViewConfig(viewId, {
        kanban: deepMerge(
          currentKanban as Record<string, unknown>,
          changes as Record<string, unknown>
        ) as KanbanViewConfig,
      })
    },

    getMergedConfig: (viewId) => {
      const { viewConfigs, pendingConfigs } = get()
      const saved = viewConfigs[viewId]
      if (!saved) return null

      return {
        saved: saved ?? null,
        pending: pendingConfigs[viewId] ?? null,
      }
    },

    resetToSaved: (viewId) => {
      set((state) => {
        const { [viewId]: _, ...restPending } = state.pendingConfigs
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)
        return {
          pendingConfigs: restPending,
          dirtyViewIds: newDirty,
        }
      })
    },

    // ─── SESSION CONFIG ACTIONS ────────────────────────────────────────────────
    updateSessionConfig: (tableId, changes) => {
      set((state) => {
        const current = state.sessionConfigs[tableId] ?? DEFAULT_UI_CONFIG

        return {
          sessionConfigs: {
            ...state.sessionConfigs,
            [tableId]: deepMerge(
              current as Record<string, unknown>,
              changes as Record<string, unknown>
            ) as TableUIConfig,
          },
        }
      })
    },

    getSessionConfig: (tableId) => {
      return get().sessionConfigs[tableId] ?? DEFAULT_UI_CONFIG
    },

    // ─── DIRTY TRACKING ────────────────────────────────────────────────────────
    markDirty: (viewId) => {
      set((state) => {
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.add(viewId)
        return { dirtyViewIds: newDirty }
      })
    },

    markClean: (viewId) => {
      set((state) => {
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)
        return { dirtyViewIds: newDirty }
      })
    },

    isDirty: (viewId) => {
      return get().dirtyViewIds.has(viewId)
    },

    // ─── PERSISTENCE ───────────────────────────────────────────────────────────
    confirmSave: (viewId, savedConfig) => {
      set((state) => {
        const { [viewId]: _, ...restPending } = state.pendingConfigs
        const newDirty = new Set(state.dirtyViewIds)
        newDirty.delete(viewId)

        return {
          viewConfigs: { ...state.viewConfigs, [viewId]: savedConfig },
          pendingConfigs: restPending,
          dirtyViewIds: newDirty,
        }
      })
    },

    setViewConfig: (viewId, config) => {
      set((state) => ({
        viewConfigs: { ...state.viewConfigs, [viewId]: config },
      }))
    },

    // ─── CLEANUP ───────────────────────────────────────────────────────────────
    clearAll: () => {
      set({
        viewConfigs: {},
        pendingConfigs: {},
        dirtyViewIds: new Set(),
        sessionConfigs: {},
      })
    },
  }))
)

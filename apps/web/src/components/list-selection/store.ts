// apps/web/src/components/list-selection/store.ts
'use client'

import { createContext, createElement, type ReactNode, useContext, useEffect, useRef } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'

/**
 * Generic, per-page bulk-selection state for `ListCard` grids — a framework-
 * agnostic generalization of the mail thread-selection store. One store instance
 * lives per `ListSelectionProvider`, so each list page is isolated and per-card
 * selectors stay granular.
 */
export interface ListSelectionState {
  /** Whether bulk-select mode is active (checkboxes shown, card click toggles). */
  bulkMode: boolean
  /**
   * True only when bulk mode was entered deliberately via the Select toggle.
   * Implicit mode (entered by checking a card) auto-exits once nothing is
   * selected; sticky mode stays on with zero selection.
   */
  sticky: boolean
  /** Selected item IDs, in selection order. */
  selectedIds: string[]
  /** Last toggled ID — the anchor for shift+click range selection. */
  anchorId: string | null
  /** Visible item IDs in display order (kept in sync by the grid). */
  itemIds: string[]
  /** IDs with a bulk action in flight — render a "Deleting…" overlay on these. */
  pendingIds: string[]
  /** Verb shown in the pending overlay, e.g. `Deleting…` / `Archiving…`. */
  pendingLabel: string

  setBulkMode: (on: boolean) => void
  setItemIds: (ids: string[]) => void
  /** Toggle one item. Pass `{ shiftKey }` to select the range from the anchor. */
  toggle: (id: string, opts?: { shiftKey?: boolean }) => void
  /** Select every visible item (Cmd/Ctrl+A). */
  selectAll: () => void
  /** Clear the selection but stay in bulk mode. */
  clear: () => void
  /** Clear the selection and leave bulk mode. */
  exit: () => void
  /** Mark an item as having a bulk action in flight. */
  addPending: (id: string) => void
  /** Clear the in-flight marker for an item (e.g. its action failed). */
  removePending: (id: string) => void
  /** Set the verb shown in the pending overlay. */
  setPendingLabel: (label: string) => void
}

function createListSelectionStore() {
  return createStore<ListSelectionState>((set, get) => ({
    bulkMode: false,
    sticky: false,
    selectedIds: [],
    anchorId: null,
    itemIds: [],
    pendingIds: [],
    pendingLabel: 'Deleting…',

    setBulkMode: (on) =>
      set(
        on
          ? { bulkMode: true, sticky: true }
          : { bulkMode: false, sticky: false, selectedIds: [], anchorId: null }
      ),

    setItemIds: (ids) => {
      // Empty list (e.g. loading) → don't prune selection. Otherwise drop any
      // selected/pending IDs no longer visible (filtered out, or removed by a
      // completed delete), so bulk state only tracks what's on screen.
      if (ids.length === 0) {
        set({ itemIds: ids })
        return
      }
      const allow = new Set(ids)
      const { selectedIds, pendingIds } = get()
      set({
        itemIds: ids,
        selectedIds: selectedIds.filter((id) => allow.has(id)),
        pendingIds: pendingIds.filter((id) => allow.has(id)),
      })
    },

    toggle: (id, opts) =>
      set((state) => {
        let selectedIds: string[]
        // Shift+click → replace selection with the anchor→id range.
        if (opts?.shiftKey && state.anchorId) {
          const from = state.itemIds.indexOf(state.anchorId)
          const to = state.itemIds.indexOf(id)
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from]
            selectedIds = state.itemIds.slice(start, end + 1)
          } else {
            selectedIds = state.selectedIds.includes(id)
              ? state.selectedIds.filter((x) => x !== id)
              : [...state.selectedIds, id]
          }
        } else {
          selectedIds = state.selectedIds.includes(id)
            ? state.selectedIds.filter((x) => x !== id)
            : [...state.selectedIds, id]
        }
        // Implicit bulk mode (entered by checking a card) switches off once the
        // selection empties; only the explicit Select toggle (`sticky`) persists.
        return {
          bulkMode: state.sticky || selectedIds.length > 0,
          anchorId: selectedIds.length > 0 ? id : null,
          selectedIds,
        }
      }),

    selectAll: () => set((state) => ({ bulkMode: true, selectedIds: [...state.itemIds] })),

    clear: () => set({ selectedIds: [], anchorId: null }),

    // `pendingIds` is intentionally left intact on exit: a card whose delete has
    // resolved keeps its overlay until the list refetch removes it (pruned by
    // `setItemIds`), so it never flashes back to a normal row mid-teardown.
    exit: () => set({ bulkMode: false, sticky: false, selectedIds: [], anchorId: null }),

    addPending: (id) =>
      set((state) =>
        state.pendingIds.includes(id) ? state : { pendingIds: [...state.pendingIds, id] }
      ),

    removePending: (id) =>
      set((state) => ({ pendingIds: state.pendingIds.filter((x) => x !== id) })),

    setPendingLabel: (label) => set({ pendingLabel: label }),
  }))
}

const ListSelectionContext = createContext<StoreApi<ListSelectionState> | null>(null)

/**
 * Provides a fresh selection store to a list page and wires the global keyboard
 * shortcuts (Cmd/Ctrl+A select-all, Escape to exit) while bulk mode is active.
 */
export function ListSelectionProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<ListSelectionState> | null>(null)
  // Lazily create one store per provider; `??=` keeps `store` typed non-null.
  const store = (storeRef.current ??= createListSelectionStore())

  const bulkMode = useStore(store, (s) => s.bulkMode)
  useEffect(() => {
    if (!bulkMode) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === 'Escape') {
        store.getState().exit()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A') && !typing) {
        e.preventDefault()
        store.getState().selectAll()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [bulkMode, store])

  return createElement(ListSelectionContext.Provider, { value: store }, children)
}

function useListSelectionApi(): StoreApi<ListSelectionState> {
  const store = useContext(ListSelectionContext)
  if (!store) throw new Error('useListSelection* must be used within a ListSelectionProvider')
  return store
}

/** Subscribe to a slice of the selection store with a selector. */
export function useListSelection<T>(selector: (state: ListSelectionState) => T): T {
  return useStore(useListSelectionApi(), selector)
}

const EMPTY_IDS: string[] = []

/** True when bulk-select mode is active. */
export const useBulkMode = () => useListSelection((s) => s.bulkMode)

/** Whether a specific item is selected — re-renders only that card. */
export const useIsSelected = (id: string) => useListSelection((s) => s.selectedIds.includes(id))

/** Count of selected items. */
export const useSelectionCount = () => useListSelection((s) => s.selectedIds.length)

/** Selected IDs (stable empty-array ref when none). */
export const useSelectionIds = () =>
  useListSelection((s) => (s.selectedIds.length > 0 ? s.selectedIds : EMPTY_IDS))

/** Whether a specific item has a bulk action in flight — re-renders only that card. */
export const useIsPending = (id: string) => useListSelection((s) => s.pendingIds.includes(id))

/** The verb shown in the pending overlay (e.g. `Deleting…`). */
export const usePendingLabel = () => useListSelection((s) => s.pendingLabel)

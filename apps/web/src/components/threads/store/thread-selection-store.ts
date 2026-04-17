// apps/web/src/components/threads/store/thread-selection-store.ts
import { create } from 'zustand'

/** View mode for thread list - 'view' shows normal list, 'edit' shows checkboxes */
export type ViewMode = 'view' | 'edit'

/**
 * Global thread selection state.
 * Only one thread list is active at a time - selection resets on list switch.
 */
interface ThreadSelectionState {
  activeThreadId: string | null
  /** Increments on every setActiveThread call so effects fire even when the ID is unchanged */
  activeThreadVersion: number
  /** Last thread interacted with (click or checkbox), used as anchor for shift+click range selection */
  selectionAnchorId: string | null
  selectedThreadIds: string[]
  /** Thread IDs currently displayed in the list, in display order */
  listThreadIds: string[]
  /** Thread with keyboard focus cursor (compact view highlight without navigation) */
  focusedThreadId: string | null
  /** When true, setFocusedThread calls are no-ops (used while popovers are anchored to a row) */
  isFocusLocked: boolean
  viewMode: ViewMode

  setActiveThread: (id: string | null) => void
  setSelectionAnchor: (id: string | null) => void
  setFocusedThread: (id: string | null) => void
  setFocusLocked: (locked: boolean) => void
  setSelectedThreads: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSelection: (id: string) => void
  clearSelection: () => void
  selectAll: (allIds: string[]) => void
  selectRange: (fromId: string, toId: string, allIds: string[]) => void
  setListThreadIds: (ids: string[]) => void
  setViewMode: (mode: ViewMode) => void
  toggleViewMode: () => void
  reset: () => void
}

const initialState = {
  activeThreadId: null as string | null,
  activeThreadVersion: 0,
  selectionAnchorId: null as string | null,
  selectedThreadIds: [] as string[],
  listThreadIds: [] as string[],
  focusedThreadId: null as string | null,
  isFocusLocked: false,
  viewMode: 'view' as ViewMode,
}

export const useThreadSelectionStore = create<ThreadSelectionState>((set, get) => ({
  ...initialState,

  setActiveThread: (id) =>
    set((state) => ({
      activeThreadId: id,
      activeThreadVersion: state.activeThreadVersion + 1,
      // Only update anchor when setting a non-null active thread
      selectionAnchorId: id !== null ? id : state.selectionAnchorId,
    })),

  setSelectionAnchor: (id) => set({ selectionAnchorId: id }),

  setFocusedThread: (id) => {
    if (get().isFocusLocked) return
    set({ focusedThreadId: id })
  },

  setFocusLocked: (locked) => set({ isFocusLocked: locked }),

  setSelectedThreads: (ids) => set({ selectedThreadIds: ids }),

  addToSelection: (id) => {
    const current = get().selectedThreadIds
    if (current.includes(id)) return
    set({ selectedThreadIds: [...current, id] })
  },

  removeFromSelection: (id) =>
    set((state) => ({
      selectedThreadIds: state.selectedThreadIds.filter((tid) => tid !== id),
    })),

  toggleSelection: (id) =>
    set((state) => ({
      selectedThreadIds: state.selectedThreadIds.includes(id)
        ? state.selectedThreadIds.filter((tid) => tid !== id)
        : [...state.selectedThreadIds, id],
    })),

  clearSelection: () =>
    set({
      selectedThreadIds: [],
      activeThreadId: null,
      selectionAnchorId: null,
      focusedThreadId: null,
    }),

  selectAll: (allIds) => set({ selectedThreadIds: allIds }),

  setListThreadIds: (ids) => set({ listThreadIds: ids }),

  selectRange: (fromId, toId, allIds) => {
    const fromIndex = allIds.indexOf(fromId)
    const toIndex = allIds.indexOf(toId)
    if (fromIndex === -1 || toIndex === -1) return
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    set({ selectedThreadIds: allIds.slice(start, end + 1) })
  },

  setViewMode: (mode) =>
    set((state) => {
      const next: Partial<ThreadSelectionState> = { viewMode: mode }
      // Entering edit mode from view mode: seed the checkbox selection with
      // the currently-open thread so the user can act on it immediately
      // without a round-trip through the checkbox.
      if (
        mode === 'edit' &&
        state.viewMode !== 'edit' &&
        state.activeThreadId &&
        !state.selectedThreadIds.includes(state.activeThreadId)
      ) {
        next.selectedThreadIds = [...state.selectedThreadIds, state.activeThreadId]
      }
      return next
    }),

  toggleViewMode: () =>
    set((state) => {
      const nextMode: ViewMode = state.viewMode === 'view' ? 'edit' : 'view'
      const next: Partial<ThreadSelectionState> = { viewMode: nextMode }
      if (
        nextMode === 'edit' &&
        state.activeThreadId &&
        !state.selectedThreadIds.includes(state.activeThreadId)
      ) {
        next.selectedThreadIds = [...state.selectedThreadIds, state.activeThreadId]
      }
      return next
    }),

  reset: () => set(initialState),
}))

// ============================================================================
// SELECTORS - Granular subscriptions to prevent re-renders
// ============================================================================

const EMPTY_ARRAY: string[] = []

/**
 * Returns the active thread ID.
 * Only re-renders when activeThreadId changes.
 */
export const useActiveThreadId = () => useThreadSelectionStore((s) => s.activeThreadId)

/**
 * Returns the active thread version counter.
 * Changes on every setActiveThread call, even when the ID is the same.
 */
export const useActiveThreadVersion = () => useThreadSelectionStore((s) => s.activeThreadVersion)

/**
 * Returns the selection anchor ID (last interacted thread, for shift+click).
 */
export const useSelectionAnchorId = () => useThreadSelectionStore((s) => s.selectionAnchorId)

/**
 * Returns the thread IDs currently displayed in the list.
 */
export const useListThreadIds = () => useThreadSelectionStore((s) => s.listThreadIds)

/**
 * Returns the focused thread ID (keyboard cursor in compact view).
 */
export const useFocusedThreadId = () => useThreadSelectionStore((s) => s.focusedThreadId)

/**
 * Returns the selected thread IDs array.
 * Uses stable empty array reference to prevent unnecessary re-renders.
 */
export const useSelectedThreadIds = () =>
  useThreadSelectionStore((s) =>
    s.selectedThreadIds.length > 0 ? s.selectedThreadIds : EMPTY_ARRAY
  )

/**
 * Returns the current view mode ('view' or 'edit').
 * Only re-renders when viewMode changes.
 */
export const useViewMode = () => useThreadSelectionStore((s) => s.viewMode)

/**
 * Returns whether edit mode is active (shows checkboxes).
 * Only re-renders when viewMode changes.
 */
export const useIsEditMode = () => useThreadSelectionStore((s) => s.viewMode === 'edit')

/**
 * @deprecated Use useIsEditMode() instead
 * Returns whether edit mode is enabled (backwards compatibility).
 */
export const useIsMultiSelectMode = () => useThreadSelectionStore((s) => s.viewMode === 'edit')

/**
 * Returns whether a specific thread is selected.
 * Only re-renders when THIS thread's selection state changes.
 * Use this in list items for granular re-renders.
 */
export const useIsThreadSelected = (threadId: string) =>
  useThreadSelectionStore((s) => s.selectedThreadIds.includes(threadId))

/**
 * Returns whether a specific thread is active.
 * Only re-renders when THIS thread's active state changes.
 * Use this in list items for granular re-renders.
 */
export const useIsThreadActive = (threadId: string) =>
  useThreadSelectionStore((s) => s.activeThreadId === threadId)

/**
 * Returns the count of selected threads.
 * Only re-renders when count changes.
 */
export const useSelectionCount = () => useThreadSelectionStore((s) => s.selectedThreadIds.length)

/**
 * Returns whether any threads are selected.
 * Only re-renders when selection goes from empty ↔ non-empty.
 */
export const useHasSelection = () => useThreadSelectionStore((s) => s.selectedThreadIds.length > 0)

/**
 * Returns whether multiple threads are selected (>1).
 * Only re-renders when count crosses the 1 threshold.
 */
export const useHasMultipleSelected = () =>
  useThreadSelectionStore((s) => s.selectedThreadIds.length > 1)

/**
 * Returns the first selected thread ID, or null if none selected.
 * Only re-renders when the first ID changes.
 */
export const useFirstSelectedThreadId = () =>
  useThreadSelectionStore((s) => s.selectedThreadIds[0] ?? null)

/**
 * Non-hook function to get store state directly.
 * Use this in callbacks and event handlers.
 */
export const getThreadSelectionState = () => useThreadSelectionStore.getState()

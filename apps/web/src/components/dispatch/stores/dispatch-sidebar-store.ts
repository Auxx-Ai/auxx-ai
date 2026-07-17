// apps/web/src/components/dispatch/stores/dispatch-sidebar-store.ts

import { createCalendarSidebarStore } from '~/components/calendar/core/sidebar-store'
import { hiddenIdsForGroup } from '~/components/calendar/core/source-visibility'

/** Sidebar group id for the Workers toggle rows — the shared store's `hidden` map keys the
 * worker inverse-visibility set under this group, may include the `UNASSIGNED_RESOURCE_ID`
 * sentinel (`board/types.ts`) for the synthetic Unassigned row. */
export const WORKERS_GROUP = 'workers'

interface DispatchSidebarExtra {
  /** `null` = every tag visible (map mode only). */
  selectedTags: string[] | null
  setSelectedTags: (tags: string[] | null) => void
  /** Dockable event panel (plan 21) — on/off + which side of the calendar it's pinned to.
   * Default off, right (opposite the always-left `DispatchSidebar`). */
  eventDock: { open: boolean; side: 'left' | 'right' }
  setEventDockOpen: (open: boolean) => void
  setEventDockSide: (side: 'left' | 'right') => void
  /** Plan 30 §B.1 — the sidebar footer's "Show canceled" toggle. Default OFF (canceled/skipped
   * visits hidden from the board and its mini-calendar day markers). `getBoard` keeps returning
   * canceled rows regardless (the toggle is a client-side filter, no refetch); day markers gain
   * the matching `includeCanceled` input on `dispatch.getVisitDayMarkers`. */
  showCanceled: boolean
  setShowCanceled: (show: boolean) => void
}

/**
 * Dispatch module sidebar persistence (v3 sidebar plan §1.1), rebuilt on the shared
 * `createCalendarSidebarStore` factory (plan §3.3) — localStorage `open`/`groupOpen`/`hidden`
 * plus dispatch's own `selectedTags` composed in as the extra slice. Consumers must use
 * selectors (`useDispatchSidebarStore((s) => s.x)`), never destructure the whole store, per
 * the project's Zustand convention.
 *
 * The old flat `hiddenWorkerIds`/`toggleWorkerHidden` are gone — workers now live under
 * `hidden.workers` (`WORKERS_GROUP`), read/written via `toggleHidden(WORKERS_GROUP, id)` or the
 * `useHiddenWorkerIds()` convenience hook below. Persisting the hidden set (not the selected
 * set) means a newly added worker defaults to visible without needing a migration.
 *
 * The factory's persist `version` is fixed at 1 with no `migrate` — per the project's
 * few-users rule, this shape change (flat `hiddenWorkerIds` → `hidden.workers`) intentionally
 * drops old persisted sidebar prefs once rather than writing migration code.
 */
export const useDispatchSidebarStore = createCalendarSidebarStore<DispatchSidebarExtra>(
  'dispatch-sidebar',
  (set) => ({
    selectedTags: null,
    setSelectedTags: (tags) => set({ selectedTags: tags }),
    eventDock: { open: false, side: 'right' },
    setEventDockOpen: (open) => set((state) => ({ eventDock: { ...state.eventDock, open } })),
    setEventDockSide: (side) => set((state) => ({ eventDock: { ...state.eventDock, side } })),
    showCanceled: false,
    setShowCanceled: (show) => set({ showCanceled: show }),
  })
)

/** Selector-stable read of the Workers group's hidden set (may include UNASSIGNED_RESOURCE_ID). */
export function useHiddenWorkerIds(): string[] {
  const hidden = useDispatchSidebarStore((s) => s.hidden)
  return hiddenIdsForGroup(hidden, WORKERS_GROUP)
}

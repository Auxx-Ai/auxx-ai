// apps/web/src/components/calendar/core/sidebar-store.ts

import { create, type StateCreator, type StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'

/** Base persisted shape shared by every calendar sidebar (dispatch, `/app/calendar`, …). */
export interface CalendarSidebarState {
  /** Whole module sidebar, open/closed. Default open. */
  open: boolean
  /** Per-group collapse state, keyed by group id. Missing key = open (all groups default
   * expanded). */
  groupOpen: Record<string, boolean>
  /** Inverse of source visibility, keyed by sidebar group id — `[]`/missing key = every item
   * in that group visible, the default. Persisting the hidden set (not the selected set)
   * means a newly added item (worker, account, …) defaults to visible without needing a
   * migration. */
  hidden: Record<string, string[]>
  setOpen: (open: boolean) => void
  setGroupOpen: (key: string, open: boolean) => void
  toggleHidden: (group: string, id: string) => void
  isHidden: (group: string, id: string) => boolean
}

function createBaseSlice<Extra extends object>(
  set: StoreApi<CalendarSidebarState & Extra>['setState'],
  get: StoreApi<CalendarSidebarState & Extra>['getState']
): CalendarSidebarState {
  return {
    open: true,
    groupOpen: {},
    hidden: {},
    setOpen: (open) => set({ open }),
    setGroupOpen: (key, open) =>
      set((state) => ({ groupOpen: { ...state.groupOpen, [key]: open } })),
    toggleHidden: (group, id) =>
      set((state) => {
        const current = new Set(state.hidden[group] ?? [])
        if (current.has(id)) current.delete(id)
        else current.add(id)
        return { hidden: { ...state.hidden, [group]: Array.from(current) } }
      }),
    isHidden: (group, id) => (get().hidden[group] ?? []).includes(id),
  }
}

/**
 * Factory for a module's persisted sidebar store (plan §3.3) — `open`/`groupOpen`/`hidden`
 * plus whatever extra slice a consumer composes in (e.g. dispatch's `selectedTags`).
 *
 * Persist `version` is fixed at 1 with no `migrate` — per the project's few-users rule, a
 * shape change to a consumer's persisted store (e.g. dispatch's old flat `hiddenWorkerIds` →
 * this factory's `hidden.workers`) is handled by bumping the *consumer's* `persistKey` or
 * accepting a one-time fresh-state drop, not by writing migration code.
 *
 * Consumers must use selectors (`useStore((s) => s.x)`), never destructure the whole store,
 * per the project's Zustand convention.
 */
export function createCalendarSidebarStore<Extra extends object = Record<string, never>>(
  persistKey: string,
  extra?: StateCreator<CalendarSidebarState & Extra, [], [], Extra>
) {
  return create<CalendarSidebarState & Extra>()(
    persist(
      (set, get, api) => ({
        ...createBaseSlice<Extra>(set, get),
        ...(extra ? extra(set, get, api) : ({} as Extra)),
      }),
      { name: persistKey, version: 1 }
    )
  )
}

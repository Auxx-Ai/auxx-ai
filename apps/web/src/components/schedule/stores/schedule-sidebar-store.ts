// apps/web/src/components/schedule/stores/schedule-sidebar-store.ts
//
// The Schedule page's calendar-view sidebar persistence (plan
// plans/calendar/02-schedule-calendar-view.md §3.2), built on the shared
// `createCalendarSidebarStore` factory — same pattern as the dispatch sidebar store
// (`dispatch/stores/dispatch-sidebar-store.ts`): localStorage `open`/`groupOpen`/`hidden`
// (module sidebar open state, group collapse, per-group hidden-source ids) plus the schedule
// page's own `view` slice, the persisted List/Day/Week/Month switch (decision F′). Default
// `'list'` — schedule is phone-first, so existing users see no change until they explicitly
// switch to a calendar view.
//
// Consumers must use selectors (`useScheduleSidebarStore((s) => s.x)`), never destructure the
// whole store, per the project's Zustand convention.

import { createCalendarSidebarStore } from '~/components/calendar/core/sidebar-store'

/** The Schedule page's four view modes. */
export type ScheduleView = 'list' | 'day' | 'week' | 'month'

interface ScheduleSidebarExtra {
  view: ScheduleView
  setView: (view: ScheduleView) => void
}

export const useScheduleSidebarStore = createCalendarSidebarStore<ScheduleSidebarExtra>(
  'schedule-sidebar',
  (set) => ({
    view: 'list',
    setView: (view) => set({ view }),
  })
)

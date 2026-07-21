// apps/web/src/components/dispatch/stores/timeline-view-store.ts

import {
  TimelineHourWidth,
  TimelineHourWidthMax,
  TimelineHourWidthMin,
  TimelineRailWidth,
  TimelineRailWidthMax,
  TimelineRailWidthMin,
  WeekCellsHeight,
  WeekCellsHeightMax,
  WeekCellsHeightMin,
} from '@auxx/ui/components/event-calendar'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface TimelineViewState {
  /** Px-per-hour on the timeline's x-axis — committed zoom level (plan 35 §5). */
  hourWidth: number
  /** Width (px) of the sticky-left worker rail (plan 35 §4). */
  railWidth: number
  /** Px-per-hour on the vertical week/day grids' y-axis — committed zoom level. */
  gridHourHeight: number
  setHourWidth: (px: number) => void
  setRailWidth: (px: number) => void
  setGridHourHeight: (px: number) => void
}

/**
 * Per-device calendar view preferences (plan 35 design record: personal, not org settings) —
 * timeline zoom/rail width plus the vertical grids' zoom, persisted to localStorage. Consumers
 * must use selectors (`useTimelineViewStore((s) => s.hourWidth)`), never destructure the whole
 * store.
 */
export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    (set) => ({
      hourWidth: TimelineHourWidth,
      railWidth: TimelineRailWidth,
      gridHourHeight: WeekCellsHeight,
      setHourWidth: (px) =>
        set({ hourWidth: clamp(Math.round(px), TimelineHourWidthMin, TimelineHourWidthMax) }),
      setRailWidth: (px) =>
        set({ railWidth: clamp(Math.round(px), TimelineRailWidthMin, TimelineRailWidthMax) }),
      setGridHourHeight: (px) =>
        set({ gridHourHeight: clamp(Math.round(px), WeekCellsHeightMin, WeekCellsHeightMax) }),
    }),
    { name: 'dispatch-timeline-view', version: 1 }
  )
)

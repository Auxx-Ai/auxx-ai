// apps/web/src/components/dispatch/stores/timeline-view-store.ts

import {
  TimelineHourWidth,
  TimelineHourWidthMax,
  TimelineHourWidthMin,
  TimelineLaneHeight,
  TimelineLaneHeightMax,
  TimelineLaneHeightMin,
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
  /** Height (px) of one event lane in a timeline worker row (plan 43) — committed row-border drag. */
  laneHeight: number
  /** Px-per-hour on the vertical week/day grids' y-axis — committed zoom level. */
  gridHourHeight: number
  /** Ephemeral "show everything" reveal (plan 42 §4) — when on, off-day columns stop hiding AND
   * the board widens the hour window to full 0-24. Per-device view state, not an org setting. */
  showAllDays: boolean
  setHourWidth: (px: number) => void
  setRailWidth: (px: number) => void
  setLaneHeight: (px: number) => void
  setGridHourHeight: (px: number) => void
  setShowAllDays: (value: boolean) => void
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
      laneHeight: TimelineLaneHeight,
      gridHourHeight: WeekCellsHeight,
      showAllDays: false,
      setHourWidth: (px) =>
        set({ hourWidth: clamp(Math.round(px), TimelineHourWidthMin, TimelineHourWidthMax) }),
      setRailWidth: (px) =>
        set({ railWidth: clamp(Math.round(px), TimelineRailWidthMin, TimelineRailWidthMax) }),
      setLaneHeight: (px) =>
        set({ laneHeight: clamp(Math.round(px), TimelineLaneHeightMin, TimelineLaneHeightMax) }),
      setGridHourHeight: (px) =>
        set({ gridHourHeight: clamp(Math.round(px), WeekCellsHeightMin, WeekCellsHeightMax) }),
      setShowAllDays: (value) => set({ showAllDays: value }),
    }),
    { name: 'dispatch-timeline-view', version: 1 }
  )
)

// apps/web/src/components/dispatch/stores/timeline-view-store.ts

import {
  TimelineHourWidth,
  TimelineHourWidthMax,
  TimelineHourWidthMin,
  TimelineRailWidth,
  TimelineRailWidthMax,
  TimelineRailWidthMin,
} from '@auxx/ui/components/event-calendar'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface TimelineViewState {
  /** Px-per-hour on the timeline's x-axis — committed zoom level (plan 35 §5). */
  hourWidth: number
  /** Width (px) of the sticky-left worker rail (plan 35 §4). */
  railWidth: number
  setHourWidth: (px: number) => void
  setRailWidth: (px: number) => void
}

/**
 * Per-device timeline view preferences (plan 35 design record: personal, not org settings) —
 * zoom level and worker-rail width, persisted to localStorage. Consumers must use selectors
 * (`useTimelineViewStore((s) => s.hourWidth)`), never destructure the whole store.
 */
export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    (set) => ({
      hourWidth: TimelineHourWidth,
      railWidth: TimelineRailWidth,
      setHourWidth: (px) =>
        set({ hourWidth: clamp(Math.round(px), TimelineHourWidthMin, TimelineHourWidthMax) }),
      setRailWidth: (px) =>
        set({ railWidth: clamp(Math.round(px), TimelineRailWidthMin, TimelineRailWidthMax) }),
    }),
    { name: 'dispatch-timeline-view', version: 1 }
  )
)

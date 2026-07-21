// packages/ui/src/components/event-calendar/assign-lanes.ts

import type { EventCalendarItem } from './types'

export interface AssignLanesResult {
  /** Event id → lane index (0-based) it was placed in. */
  lanes: Map<string, number>
  /** Number of lanes used to fit every event — `0` for an empty input, otherwise `>= 1`. */
  laneCount: number
}

/**
 * Greedy interval-partitioning ("minimum number of rooms"): sort events by start time (ties
 * broken by longer duration first), then place each event in the first lane whose last-placed
 * event ends at or before this event's start. Overlapping events land in different lanes.
 *
 * Pure and orientation-agnostic — the horizontal timeline view uses it per worker per rendered
 * day to size stacked event lanes (`TimelineLaneHeight` per lane); nothing here assumes an axis.
 */
export function assignLanes(events: EventCalendarItem[]): AssignLanesResult {
  if (events.length === 0) return { lanes: new Map(), laneCount: 0 }

  const sorted = [...events].sort((a, b) => {
    const aStart = new Date(a.start).getTime()
    const bStart = new Date(b.start).getTime()
    if (aStart !== bStart) return aStart - bStart
    const aDuration = new Date(a.end).getTime() - aStart
    const bDuration = new Date(b.end).getTime() - bStart
    return bDuration - aDuration
  })

  // laneEnds[i] = end time (ms) of the last event currently occupying lane i.
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()

  for (const event of sorted) {
    const start = new Date(event.start).getTime()
    const end = new Date(event.end).getTime()

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) lane = laneEnds.length

    laneEnds[lane] = end
    lanes.set(event.id, lane)
  }

  return { lanes, laneCount: laneEnds.length }
}

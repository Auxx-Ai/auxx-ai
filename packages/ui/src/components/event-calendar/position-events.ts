// packages/ui/src/components/event-calendar/position-events.ts

import {
  addHours,
  areIntervalsOverlapping,
  getHours,
  getMinutes,
  isSameDay,
  startOfDay,
} from 'date-fns'

import type { EventCalendarItem } from './types'

export interface PositionedEvent<T extends EventCalendarItem = EventCalendarItem> {
  event: T
  top: number
  height: number
  left: number
  width: number
  zIndex: number
}

interface PositionEventsOptions {
  /** Pixel height of one hour row (`WeekCellsHeight`). */
  cellHeight: number
  /** First hour rendered by the grid (`StartHour`). */
  startHour: number
}

/**
 * Lays out a single day/column's timed events for week/day/resource views.
 * Extracted so day, week, and resource-day all share one positioning algorithm
 * instead of three copies of the same top/height/column math.
 *
 * Overlap variant: **side-by-side** equal-width columns (not the upstream
 * cascade). Events are grouped into overlap clusters (connected components),
 * each cluster gets a greedy interval-graph column assignment (optimal for
 * interval graphs — column count == max concurrent overlap), and every event
 * in a cluster is given `width = 1 / clusterColumnCount` so overlapping visits
 * read as clean equal-width columns rather than a shrinking cascade.
 */
export function positionEventsForDay<T extends EventCalendarItem>(
  events: T[],
  referenceDay: Date,
  { cellHeight, startHour }: PositionEventsOptions
): PositionedEvent<T>[] {
  if (events.length === 0) return []

  const dayStart = startOfDay(referenceDay)

  const sorted = [...events].sort((a, b) => {
    const aStart = new Date(a.start).getTime()
    const bStart = new Date(b.start).getTime()
    if (aStart !== bStart) return aStart - bStart
    const aDuration = new Date(a.end).getTime() - aStart
    const bDuration = new Date(b.end).getTime() - bStart
    return bDuration - aDuration
  })

  const items = sorted.map((event) => {
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    const start = isSameDay(referenceDay, eventStart) ? eventStart : dayStart
    const end = isSameDay(referenceDay, eventEnd) ? eventEnd : addHours(dayStart, 24)
    return { event, start, end, column: 0 }
  })

  // Union-find over pairwise overlaps to build connected "clusters" — a chain
  // of overlapping events shares one column count even if two events at the
  // ends of the chain don't directly overlap each other.
  const parent = items.map((_, i) => i)
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]] as number
      i = parent[i] as number
    }
    return i
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (!a || !b) continue
      if (areIntervalsOverlapping({ start: a.start, end: a.end }, { start: b.start, end: b.end })) {
        union(i, j)
      }
    }
  }

  const clusters = new Map<number, number[]>()
  items.forEach((_, i) => {
    const root = find(i)
    const arr = clusters.get(root) ?? []
    arr.push(i)
    clusters.set(root, arr)
  })

  const positioned: PositionedEvent<T>[] = new Array(items.length)

  for (const memberIndices of clusters.values()) {
    const members = memberIndices
      .map((i) => ({ index: i, ...(items[i] as (typeof items)[number]) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    // Greedy first-fit column assignment — optimal column count for interval graphs.
    const columnEnds: Date[] = []
    for (const member of members) {
      let col = 0
      while (col < columnEnds.length && (columnEnds[col] as Date) > member.start) {
        col++
      }
      columnEnds[col] = member.end
      member.column = col
    }

    const columnCount = columnEnds.length

    for (const member of members) {
      const startHourFloat = getHours(member.start) + getMinutes(member.start) / 60
      const endHourFloat = getHours(member.end) + getMinutes(member.end) / 60
      const top = (startHourFloat - startHour) * cellHeight
      const height = (endHourFloat - startHourFloat) * cellHeight

      positioned[member.index] = {
        event: member.event,
        top,
        height,
        left: member.column / columnCount,
        width: 1 / columnCount,
        zIndex: 10 + member.column,
      }
    }
  }

  return positioned
}

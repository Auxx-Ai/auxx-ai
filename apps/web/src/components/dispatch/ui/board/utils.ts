// apps/web/src/components/dispatch/ui/board/utils.ts

import type { BackgroundEvent } from '@auxx/ui/components/event-calendar'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import type {
  BoardViewMode,
  BoardVisit,
  BoardWorker,
  BoardWorkOrder,
  DispatchVisitEvent,
  VisitStatus,
} from './types'
import { UNASSIGNED_RESOURCE_ID, VISIT_STATUS_FORWARD_ORDER, VISIT_STATUS_VALUES } from './types'

/** Next status in the forward lifecycle, or `null` at the terminal step (`done`). */
export function nextVisitStatus(current: VisitStatus): VisitStatus | null {
  const index = VISIT_STATUS_FORWARD_ORDER.indexOf(current)
  if (index === -1 || index === VISIT_STATUS_FORWARD_ORDER.length - 1) return null
  return VISIT_STATUS_FORWARD_ORDER[index + 1]!
}

/**
 * Where a visit's scheduled day sits relative to the viewer's local today. Execution
 * actions (advance to en route / on site / complete) are day-of actions — they render
 * only for 'today' and 'past' ('past' additionally gets an overdue hint). Day boundaries
 * are always client-local, matching the board's client-computed day-window convention.
 */
export type VisitDayContext = 'unscheduled' | 'past' | 'today' | 'future'

export function getVisitDayContext(
  startTime: Date | null | undefined,
  endTime?: Date | null
): VisitDayContext {
  if (!startTime) return 'unscheduled'
  const todayStart = startOfDay(new Date())
  if (startOfDay(startTime) > todayStart) return 'future'
  if (startOfDay(endTime ?? startTime) < todayStart) return 'past'
  return 'today'
}

/** Execution (status-advance) actions only make sense once the visit's day has arrived. */
export function isExecutionReady(context: VisitDayContext): boolean {
  return context === 'today' || context === 'past'
}

/** Fallback chip color when a worker has none set. */
export const DEFAULT_WORKER_COLOR = '#6366f1'
/** Color for the always-first "Unassigned" column's chips. */
export const UNASSIGNED_COLOR = '#94a3b8'

export function isVisitStatus(value: string): value is VisitStatus {
  return (VISIT_STATUS_VALUES as readonly string[]).includes(value)
}

/**
 * Adapter (v3 sidebar plan §1.1): the module sidebar persists a *hidden*-worker id set
 * (inverse of visibility, may include the synthetic `UNASSIGNED_RESOURCE_ID` sentinel for the
 * Unassigned row) instead of a selected set. Board/map/planner consumers keep their pre-v3
 * `selectedWorkerIds: Set<string> | null` contract untouched (`null` = every worker visible) —
 * this strips the sentinel (not a real worker id) and inverts hidden → selected, collapsing back
 * to `null` when nothing real is hidden (mirrors `WorkerFilterPopover`'s old
 * `next.size === workers.length ? null : next` collapse).
 */
export function selectedWorkerIdsFromHidden(
  hiddenWorkerIds: string[],
  allWorkers: BoardWorker[]
): Set<string> | null {
  const hiddenReal = hiddenWorkerIds.filter((id) => id !== UNASSIGNED_RESOURCE_ID)
  if (hiddenReal.length === 0) return null
  const hidden = new Set(hiddenReal)
  return new Set(allWorkers.filter((w) => !hidden.has(w.userId)).map((w) => w.userId))
}

/** Whether a visit's assignee (or `null` for Unassigned) is hidden per the sidebar's Workers
 * group toggles — used both by `use-board-data.ts` (the Unassigned column/events) and the
 * mini-calendar density hook. */
export function isWorkerHidden(hiddenWorkerIds: string[], assigneeUserId: string | null): boolean {
  return hiddenWorkerIds.includes(assigneeUserId ?? UNASSIGNED_RESOURCE_ID)
}

/** A `SettingValue` read via `getSetting` may be a scalar or (defensively) a 1-item array. */
export function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

export type WeekStartIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * The month the stream-style month view is "viewing" for an anchor date: the month of the
 * date's week END — a month's first grid row usually starts with the previous month's
 * trailing days, and the month view anchors `date` to that row's top-left cell.
 */
export function viewedMonthStart(date: Date, weekStartsOn: WeekStartIndex): Date {
  return startOfMonth(endOfWeek(date, { weekStartsOn }))
}

export function goToPreviousDate(
  view: BoardViewMode,
  date: Date,
  weekStartsOn: WeekStartIndex
): Date {
  if (view === 'day') return subDays(date, 1)
  if (view === 'week') return subWeeks(date, 1)
  return startOfWeek(subMonths(viewedMonthStart(date, weekStartsOn), 1), { weekStartsOn })
}

export function goToNextDate(view: BoardViewMode, date: Date, weekStartsOn: WeekStartIndex): Date {
  if (view === 'day') return addDays(date, 1)
  if (view === 'week') return addWeeks(date, 1)
  return startOfWeek(addMonths(viewedMonthStart(date, weekStartsOn), 1), { weekStartsOn })
}

/** Only visits with both `startTime`/`endTime` render on the grid. */
export function isScheduledVisit(
  visit: BoardVisit
): visit is BoardVisit & { startTime: Date; endTime: Date } {
  return Boolean(visit.startTime && visit.endTime)
}

/** Board's own visits array is range + backlog combined (§B.6) — split it back out. */
export function splitVisits(visits: BoardVisit[]) {
  const scheduled = visits.filter(isScheduledVisit)
  const backlog = visits.filter((v) => !v.startTime)
  return { scheduled, backlog }
}

export function visitToEvent(
  visit: BoardVisit & { startTime: Date; endTime: Date },
  workOrderById: Map<string, BoardWorkOrder>,
  colorByUserId: Map<string, string>
): DispatchVisitEvent {
  const workOrder = workOrderById.get(visit.workOrderId)
  const title = workOrder
    ? `${workOrder.number ? `${workOrder.number} · ` : ''}${workOrder.displayName ?? 'Work order'}`
    : 'Work order'
  const color = visit.assigneeUserId
    ? (colorByUserId.get(visit.assigneeUserId) ?? DEFAULT_WORKER_COLOR)
    : UNASSIGNED_COLOR

  return {
    id: visit.id,
    title,
    start: visit.startTime,
    end: visit.endTime,
    color,
    resourceId: visit.assigneeUserId ?? UNASSIGNED_RESOURCE_ID,
    workOrderId: visit.workOrderId,
    assigneeUserId: visit.assigneeUserId,
    status: isVisitStatus(visit.status) ? visit.status : 'scheduled',
    dispatchedAt: visit.dispatchedAt ? new Date(visit.dispatchedAt).toISOString() : null,
    workOrder,
  }
}

/**
 * Off-hours shading for one calendar day: the complement of a `ResolvedDay`'s available
 * ranges (minutes-since-midnight) within `[0, 1440)`. Closed days shade the whole day.
 */
export function offHoursBackgroundEvents(
  date: Date,
  ranges: Array<{ start: number; end: number }>,
  resourceId?: string
): BackgroundEvent[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const events: BackgroundEvent[] = []
  let cursor = 0

  const push = (startMin: number, endMin: number) => {
    if (endMin <= startMin) return
    const start = new Date(date)
    start.setHours(0, startMin, 0, 0)
    const end = new Date(date)
    end.setHours(0, endMin, 0, 0)
    events.push({ resourceId, date, start, end, className: 'bg-muted/60' })
  }

  for (const range of sorted) {
    if (range.start > cursor) push(cursor, range.start)
    cursor = Math.max(cursor, range.end)
  }
  push(cursor, 1440)

  return events
}

/** Two [start,end) intervals overlap. */
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Visit ids that overlap another visit assigned to the same resource (worker/unassigned
 * column) — a same-column time collision, the board's "amber outline" hint (never a block).
 */
export function computeOverlappingVisitIds(events: DispatchVisitEvent[]): Set<string> {
  const overlapping = new Set<string>()
  const byResource = new Map<string, DispatchVisitEvent[]>()
  for (const event of events) {
    const key = event.resourceId ?? UNASSIGNED_RESOURCE_ID
    const list = byResource.get(key) ?? []
    list.push(event)
    byResource.set(key, list)
  }
  for (const list of byResource.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (intervalsOverlap(a.start, a.end, b.start, b.end)) {
          overlapping.add(a.id)
          overlapping.add(b.id)
        }
      }
    }
  }
  return overlapping
}

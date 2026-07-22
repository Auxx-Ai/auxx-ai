// apps/web/src/components/dispatch/ui/board/utils.ts

import {
  getOptionColor,
  type OptionColor,
  type SelectOptionColor,
} from '@auxx/lib/custom-fields/client'
import type { BackgroundEvent, EventColorClasses } from '@auxx/ui/components/event-calendar'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  getDaysInMonth,
  setDate as setDayOfMonth,
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

/**
 * Whether a board event's own window has already passed — done/canceled, or a past scheduled
 * span. Mirrors `job-schedule-utils.ts`'s `isPastVisit` (that helper's `Pick<JobVisit, ...>`
 * param isn't structurally identical to `DispatchVisitEvent`, so this is a board-local twin
 * rather than an import). Drives the past-occurrence series-scope chooser collapse (plan 30
 * §D.2) at the popover's two mount sites (`board-calendar-grid.tsx`, `event-dock-panel.tsx`).
 */
export function isPastVisitEvent(event: Pick<DispatchVisitEvent, 'status' | 'end'>): boolean {
  if (event.status === 'done' || event.status === 'canceled') return true
  return event.end.getTime() < Date.now()
}

/** Fallback chip color when a worker has none set. */
export const DEFAULT_WORKER_COLOR = '#6366f1'
/** Color for the always-first "Unassigned" column's chips. */
export const UNASSIGNED_COLOR = '#94a3b8'
/** Palette-id twins of the two hex fallbacks above, for the badge-look chip classes. */
const DEFAULT_WORKER_COLOR_ID: SelectOptionColor = 'indigo'
const UNASSIGNED_COLOR_ID: SelectOptionColor = 'gray'

/** Project an `OPTION_COLORS` entry onto the calendar chip's badge-look class contract. */
function toEventColorClasses(color: OptionColor): EventColorClasses {
  return {
    badge: color.badgeClasses,
    selectedBorder: color.selectedBorderClasses,
    solid: color.swatch,
  }
}

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
  // `timeline` (plan 18) is the resource day-stream — it steps a single day, exactly like `day`.
  if (view === 'day' || view === 'timeline') return subDays(date, 1)
  if (view === 'week') return subWeeks(date, 1)
  return startOfWeek(subMonths(viewedMonthStart(date, weekStartsOn), 1), { weekStartsOn })
}

export function goToNextDate(view: BoardViewMode, date: Date, weekStartsOn: WeekStartIndex): Date {
  if (view === 'day' || view === 'timeline') return addDays(date, 1)
  if (view === 'week') return addWeeks(date, 1)
  return startOfWeek(addMonths(viewedMonthStart(date, weekStartsOn), 1), { weekStartsOn })
}

/**
 * Month-view anchor reducer. The month stream re-anchors the board's active `date` on both
 * chevron paging and scroll-settle (`month-view.tsx` emits the settled row's grid-boundary
 * top-left day) — neither of which carries the day-of-month the user cares about. This keeps the
 * previous anchor's day-of-month inside the newly *viewed* month (`startOfMonth(endOfWeek(...))`,
 * the same "viewed month" rule the month stream uses), clamped to the month's length, so toggling
 * to Map or Day view returns to that day. Day/week/timeline don't call this — their anchor is just
 * the emitted first/leftmost day.
 */
export function withPreservedDayOfMonth(
  prev: Date,
  next: Date,
  weekStartsOn: WeekStartIndex
): Date {
  const viewedMonth = startOfMonth(endOfWeek(next, { weekStartsOn }))
  const candidate = setDayOfMonth(
    viewedMonth,
    Math.min(prev.getDate(), getDaysInMonth(viewedMonth))
  )
  // A late-month day whose week ends in the NEXT month would itself "view" that next month
  // and re-anchor the stream a month ahead of where the user settled — clamp to the last
  // day whose week still ends inside the viewed month.
  if (viewedMonthStart(candidate, weekStartsOn).getTime() === viewedMonth.getTime()) {
    return candidate
  }
  return subDays(startOfWeek(candidate, { weekStartsOn }), 1)
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
  colorByUserId: Map<string, OptionColor>
): DispatchVisitEvent {
  const workOrder = workOrderById.get(visit.workOrderId)
  const title = workOrder
    ? `${workOrder.number ? `${workOrder.number} · ` : ''}${workOrder.displayName ?? 'Work order'}`
    : 'Work order'
  // Chip coloring is the badge look (plan 11 follow-up): the assigned worker's stored palette
  // entry supplies `colorClasses`; the resolved hex is still stamped on `color` for non-chip
  // consumers (sidebar dots, map pins).
  const optionColor = visit.assigneeUserId
    ? (colorByUserId.get(visit.assigneeUserId) ?? getOptionColor(DEFAULT_WORKER_COLOR_ID))
    : getOptionColor(UNASSIGNED_COLOR_ID)
  const color = visit.assigneeUserId ? optionColor.hex : UNASSIGNED_COLOR

  return {
    id: visit.id,
    title,
    start: visit.startTime,
    end: visit.endTime,
    color,
    colorClasses: toEventColorClasses(optionColor),
    resourceId: visit.assigneeUserId ?? UNASSIGNED_RESOURCE_ID,
    workOrderId: visit.workOrderId,
    assigneeUserId: visit.assigneeUserId,
    status: isVisitStatus(visit.status) ? visit.status : 'scheduled',
    dispatchedAt: visit.dispatchedAt ? new Date(visit.dispatchedAt).toISOString() : null,
    recurrenceRuleId: visit.recurrenceRuleId ?? null,
    workOrder,
    // Plan 20 §4.1/§4.3 — threaded straight through (whole-row select); the flag consumers need
    // is just null-vs-not, so this only needs a wire-safe (string) shape, not a parsed Date.
    timeConfirmedAt: visit.timeConfirmedAt ? new Date(visit.timeConfirmedAt).toISOString() : null,
    durationMinutes: visit.durationMinutes ?? null,
    timezone: visit.timezone ?? null,
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
    // Match the month view's off-day tint — `muted`-based tints disappear on white.
    events.push({ resourceId, date, start, end, className: 'bg-muted-foreground/6' })
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

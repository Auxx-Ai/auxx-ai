// packages/ui/src/components/event-calendar/types.ts

import type { ReactNode } from 'react'

/** Which grid the calendar shell is currently rendering. */
export type CalendarView = 'month' | 'week' | 'day' | 'agenda' | 'resource' | 'timeline'

/**
 * Base event shape the calendar renders. Consumers extend this with their own
 * fields (e.g. a dispatch visit's `workOrderId`/`assigneeUserId`) via the `T`
 * generic on `EventCalendar`/`CalendarDndProvider` and the view components.
 *
 * Named `EventCalendarItem` (not `CalendarEvent`) to avoid colliding with the
 * database's `CalendarEvent` table when both are in scope in `apps/web`.
 */
export interface EventCalendarItem {
  id: string
  title: string
  description?: string
  start: Date
  end: Date
  allDay?: boolean
  /** Raw class name (or inline-style-friendly token) — the calendar no longer ships a fixed color palette. */
  color?: string
  location?: string
  /** Set when the event belongs to a `resources` day-view column. */
  resourceId?: string
  /** Optional trailing indicator rendered by the default chip (e.g. a recurrence icon). */
  badge?: ReactNode
}

/** A column in `resources` day mode — one per worker/vehicle/etc. */
export interface CalendarResource {
  id: string
  label: string
  header?: ReactNode
}

/**
 * Visible hour range for the horizontal timeline view (`HorizontalTimelineView`) — start/end are
 * fractional hours (0–24). Defaults to `{ start: StartHour, end: EndHour }` (the full day) when a
 * consumer doesn't derive a narrower working-hours window.
 */
export interface TimelineHourWindow {
  start: number
  end: number
}

/**
 * Absolutely positioned, non-interactive shading — off-hours, time-off, etc.
 * Rendered below event chips in day/week/resource views.
 */
export interface BackgroundEvent {
  resourceId?: string
  date?: Date
  start: Date
  end: Date
  className?: string
}

export interface RenderEventContext {
  view: CalendarView
  isFirstDay: boolean
  isLastDay: boolean
  isDragging: boolean
}

/** Consumer-owned chip content — the calendar never hardcodes chip markup/color when this is provided. */
export type RenderEvent<T extends EventCalendarItem = EventCalendarItem> = (
  event: T,
  ctx: RenderEventContext
) => ReactNode

// packages/ui/src/components/event-calendar/utils.ts

import { isSameDay } from 'date-fns'
import type { CSSProperties } from 'react'

import { DefaultEventColor } from './constants'
import type { EventCalendarItem } from './types'

/**
 * Sets the `--ec-color` custom property an event chip's Tailwind arbitrary-value
 * classes read from (see `eventTintBgClass`/`eventTintTextClass`/etc below).
 * Falls back to `DefaultEventColor` — the calendar no longer ships a fixed palette.
 */
export function eventColorVar(color?: string): CSSProperties {
  return { '--ec-color': color || DefaultEventColor } as CSSProperties
}

// Literal (non-templated) Tailwind arbitrary-value classes so the JIT scanner
// picks them up statically — they all read the per-chip `--ec-color` variable
// set via `eventColorVar`, which is how a single class works for any color
// value AND both themes (color-mix against `transparent` is naturally
// theme-safe; the dark: variant just boosts opacity for legibility).
// Tint tuned to a Notion-Calendar level (was 6%/18% — nearly invisible in light mode).
export const eventTintBgClass =
  'bg-[color-mix(in_oklch,var(--ec-color)_14%,transparent)] dark:bg-[color-mix(in_oklch,var(--ec-color)_28%,transparent)]'
export const eventTintTextClass =
  'text-[color-mix(in_oklch,var(--ec-color)_70%,black)] dark:text-[color-mix(in_oklch,var(--ec-color)_55%,white)]'
export const eventSolidBgClass = 'bg-[var(--ec-color)]'
export const eventBorderAccentClass = 'border-[var(--ec-color)]'

/**
 * Get CSS classes for border radius based on event position in multi-day events
 */
export function getBorderRadiusClasses(isFirstDay: boolean, isLastDay: boolean): string {
  if (isFirstDay && isLastDay) return 'rounded-xl'
  if (isFirstDay) return 'rounded-l-xl rounded-r-none'
  if (isLastDay) return 'rounded-r-xl rounded-l-none'
  return 'rounded-none'
}

/**
 * Check if an event is a multi-day event
 */
export function isMultiDayEvent(event: EventCalendarItem): boolean {
  const eventStart = new Date(event.start)
  const eventEnd = new Date(event.end)
  return Boolean(event.allDay) || eventStart.getDate() !== eventEnd.getDate()
}

/**
 * Filter events for a specific day
 */
export function getEventsForDay<T extends EventCalendarItem>(events: T[], day: Date): T[] {
  return events
    .filter((event) => isSameDay(day, new Date(event.start)))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

/**
 * Sort events with multi-day events first, then by start time
 */
export function sortEvents<T extends EventCalendarItem>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const aIsMultiDay = isMultiDayEvent(a)
    const bIsMultiDay = isMultiDayEvent(b)

    if (aIsMultiDay && !bIsMultiDay) return -1
    if (!aIsMultiDay && bIsMultiDay) return 1

    return new Date(a.start).getTime() - new Date(b.start).getTime()
  })
}

/**
 * Get multi-day events that span across a specific day (but don't start on that day)
 */
export function getSpanningEventsForDay<T extends EventCalendarItem>(events: T[], day: Date): T[] {
  return events.filter((event) => {
    if (!isMultiDayEvent(event)) return false

    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)

    return (
      !isSameDay(day, eventStart) &&
      (isSameDay(day, eventEnd) || (day > eventStart && day < eventEnd))
    )
  })
}

/**
 * Get all events visible on a specific day (starting, ending, or spanning)
 */
export function getAllEventsForDay<T extends EventCalendarItem>(events: T[], day: Date): T[] {
  return events.filter((event) => {
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    return (
      isSameDay(day, eventStart) || isSameDay(day, eventEnd) || (day > eventStart && day < eventEnd)
    )
  })
}

/**
 * Get all events for a day (for agenda view)
 */
export function getAgendaEventsForDay<T extends EventCalendarItem>(events: T[], day: Date): T[] {
  return events
    .filter((event) => {
      const eventStart = new Date(event.start)
      const eventEnd = new Date(event.end)
      return (
        isSameDay(day, eventStart) ||
        isSameDay(day, eventEnd) ||
        (day > eventStart && day < eventEnd)
      )
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

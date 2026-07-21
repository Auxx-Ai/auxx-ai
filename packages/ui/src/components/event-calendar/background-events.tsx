// packages/ui/src/components/event-calendar/background-events.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { getHours, getMinutes, isSameDay } from 'date-fns'

import { StartHour } from './constants'
import type { BackgroundEvent } from './types'

interface BackgroundEventsLayerProps {
  events: BackgroundEvent[]
  day: Date
  /** When set, only background events matching this resource (or with no `resourceId`) render. */
  resourceId?: string
  cellHeight: number
  /**
   * Layout orientation. `'y'` (default) positions segments as `top`/`height` against
   * `StartHour..24` — week/day/resource's vertical grids. `'x'` positions them as `left`/`width`
   * (percent of `windowStartHour..windowEndHour`) and spans full row height — the horizontal
   * timeline view.
   */
  orientation?: 'x' | 'y'
  /** Visible hour window start — `orientation: 'x'` only. */
  windowStartHour?: number
  /** Visible hour window end — `orientation: 'x'` only. */
  windowEndHour?: number
}

/**
 * Absolutely positioned, non-interactive shading layer — off-hours, time-off,
 * overlaps, etc. Rendered `pointer-events-none` and BELOW the z-10 event
 * chips (z-0) so it never intercepts clicks/drags; the current-time
 * indicator's z-20 sits above both.
 */
export function BackgroundEventsLayer({
  events,
  day,
  resourceId,
  cellHeight,
  orientation = 'y',
  windowStartHour,
  windowEndHour,
}: BackgroundEventsLayerProps) {
  const dayEvents = events.filter((bg) => {
    if (bg.resourceId !== undefined && bg.resourceId !== resourceId) return false
    if (bg.date !== undefined && !isSameDay(bg.date, day)) return false
    const start = new Date(bg.start)
    const end = new Date(bg.end)
    return isSameDay(day, start) || isSameDay(day, end) || (start < day && end > day)
  })

  if (dayEvents.length === 0) return null

  if (orientation === 'x') {
    const winStart = windowStartHour ?? StartHour
    const winEnd = windowEndHour ?? 24
    const windowHours = winEnd - winStart
    if (windowHours <= 0) return null

    return (
      <>
        {dayEvents.map((bg, index) => {
          const start = new Date(bg.start)
          const end = new Date(bg.end)
          const startHour = isSameDay(day, start) ? getHours(start) + getMinutes(start) / 60 : 0
          const endHour = isSameDay(day, end) ? getHours(end) + getMinutes(end) / 60 : 24
          // Clamp to the visible hour window — segments entirely outside it collapse to nothing.
          const clampedStart = Math.min(Math.max(startHour, winStart), winEnd)
          const clampedEnd = Math.min(Math.max(endHour, winStart), winEnd)
          if (clampedEnd <= clampedStart) return null
          const left = ((clampedStart - winStart) / windowHours) * 100
          const width = ((clampedEnd - clampedStart) / windowHours) * 100

          return (
            <div
              key={index}
              className={cn(
                'pointer-events-none absolute inset-y-0 z-0',
                bg.className ?? 'bg-muted/40'
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}
      </>
    )
  }

  return (
    <>
      {dayEvents.map((bg, index) => {
        const start = new Date(bg.start)
        const end = new Date(bg.end)
        const startHour = isSameDay(day, start) ? getHours(start) + getMinutes(start) / 60 : 0
        const endHour = isSameDay(day, end) ? getHours(end) + getMinutes(end) / 60 : 24
        const top = (startHour - StartHour) * cellHeight
        const height = (endHour - startHour) * cellHeight

        return (
          <div
            key={index}
            className={cn(
              'pointer-events-none absolute inset-x-0 z-0',
              bg.className ?? 'bg-muted/40'
            )}
            style={{ top: `${top}px`, height: `${height}px` }}
          />
        )
      })}
    </>
  )
}

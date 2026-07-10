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
}: BackgroundEventsLayerProps) {
  const dayEvents = events.filter((bg) => {
    if (bg.resourceId !== undefined && bg.resourceId !== resourceId) return false
    if (bg.date !== undefined && !isSameDay(bg.date, day)) return false
    const start = new Date(bg.start)
    const end = new Date(bg.end)
    return isSameDay(day, start) || isSameDay(day, end) || (start < day && end > day)
  })

  if (dayEvents.length === 0) return null

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

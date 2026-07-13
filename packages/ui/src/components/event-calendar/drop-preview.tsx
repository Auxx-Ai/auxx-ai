// packages/ui/src/components/event-calendar/drop-preview.tsx

'use client'

import { differenceInMinutes, isSameDay } from 'date-fns'

import { useCalendarDnd } from './calendar-dnd-context'
import { StartHour, WeekCellsHeight } from './constants'

interface DropPreviewProps {
  /** The column's day — the outline shows only when the snapped drop target lands here. */
  day: Date
  /** Resource column id (resource view only) — the outline shows only when the hovered cell matches. */
  resourceId?: string
}

/**
 * Dashed outline marking the snapped landing slot while a timed event is
 * dragged over this column. Reads the live (already quarter-hour-snapped)
 * `currentTime` from the DnD context and paints a block at that time for the
 * dragged event's duration — the "where it will land" affordance. Renders
 * nothing unless a timed drag is in progress and its target resolves to this
 * exact column.
 */
export function DropPreview({ day, resourceId }: DropPreviewProps) {
  const { activeEvent, currentTime, activeView, currentResourceId } = useCalendarDnd()

  // No timed drag in flight, or a month drag (whole-day, no time slot to outline).
  if (!activeEvent || !currentTime || activeView === 'month') return null
  if (!isSameDay(currentTime, day)) return null
  // Resource view packs many same-day columns side by side — gate on the hovered resource too.
  if (resourceId !== undefined && currentResourceId !== resourceId) return null

  const startMinutes = (currentTime.getHours() - StartHour) * 60 + currentTime.getMinutes()
  const durationMinutes = differenceInMinutes(
    new Date(activeEvent.end),
    new Date(activeEvent.start)
  )
  const top = (startMinutes / 60) * WeekCellsHeight
  // Floor a zero/negative duration to a single quarter-hour so the outline is always visible.
  const height = Math.max((durationMinutes / 60) * WeekCellsHeight, WeekCellsHeight / 4)

  return (
    <div
      className='border-primary/70 bg-primary/5 pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed'
      style={{ top, height }}
    />
  )
}

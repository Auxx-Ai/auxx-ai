// packages/ui/src/components/event-calendar/agenda-view.tsx

'use client'

import { addDays, format, isToday } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { useMemo } from 'react'

import { AgendaDaysToShow } from './constants'
import { EventItem } from './event-item'
import { useCalendarSelection } from './selection/calendar-selection-context'
import type { EventCalendarItem, RenderEvent } from './types'
import { getAgendaEventsForDay } from './utils'

interface AgendaViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  onEventSelect: (event: T, e: React.MouseEvent) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
}

export function AgendaView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  onEventSelect,
  renderEvent,
  selectedIds,
}: AgendaViewProps<T>) {
  const selection = useCalendarSelection()
  const days = useMemo(() => {
    return Array.from({ length: AgendaDaysToShow }, (_, i) => addDays(new Date(currentDate), i))
  }, [currentDate])

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event, e)
  }

  const hasEvents = days.some((day) => getAgendaEventsForDay(events, day).length > 0)

  return (
    <div className='border-border/70 border-t px-4'>
      {!hasEvents ? (
        <div className='flex min-h-[70svh] flex-col items-center justify-center py-16 text-center'>
          <CalendarIcon size={32} className='text-muted-foreground/50 mb-2' />
          <h3 className='text-lg font-medium'>No events found</h3>
          <p className='text-muted-foreground'>
            There are no events scheduled for this time period.
          </p>
        </div>
      ) : (
        days.map((day) => {
          const dayEvents = getAgendaEventsForDay(events, day)
          if (dayEvents.length === 0) return null

          return (
            <div key={day.toString()} className='border-border/70 relative my-12 border-t'>
              <span
                className='bg-background absolute -top-3 left-0 flex h-6 items-center pe-4 text-[10px] uppercase data-today:font-medium sm:pe-4 sm:text-xs'
                data-today={isToday(day) || undefined}>
                {format(day, 'd MMM, EEEE')}
              </span>
              <div className='mt-6 space-y-2'>
                {/* Site 1/1: agenda card. Agenda bypasses `DraggableEvent` (no drag/resize here),
                    so it registers into the marquee's chip registry itself — selection rendering
                    only, agenda is a plain list with no spatial marquee. */}
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    ref={(node) => {
                      if (node) selection.registerChip(event.id, node)
                      return () => selection.unregisterChip(event.id)
                    }}
                    data-event-id={event.id}>
                    <EventItem
                      event={event}
                      view='agenda'
                      onClick={(e) => handleEventClick(event, e)}
                      isSelected={selectedIds?.has(event.id) ?? false}
                      renderEvent={renderEvent}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

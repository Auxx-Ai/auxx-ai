// packages/ui/src/components/event-calendar/month-view.tsx

'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useEffect, useMemo, useState } from 'react'

import { DefaultStartHour, EventGap, EventHeight } from './constants'
import { DraggableEvent } from './draggable-event'
import { DroppableCell } from './droppable-cell'
import { EventItem } from './event-item'
import { useEventVisibility } from './hooks/use-event-visibility'
import type { EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, getEventsForDay, getSpanningEventsForDay, sortEvents } from './utils'

interface MonthViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  renderEvent?: RenderEvent<T>
}

export function MonthView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  weekStartsOn,
  onEventSelect,
  onSlotClick,
  renderEvent,
}: MonthViewProps<T>) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(monthStart)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [currentDate, weekStartsOn])

  const weekdays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const date = addDays(startOfWeek(new Date(), { weekStartsOn }), i)
      return format(date, 'EEE')
    })
  }, [weekStartsOn])

  const weeks = useMemo(() => {
    const result: Date[][] = []
    let week: Date[] = []
    for (let i = 0; i < days.length; i++) {
      week.push(days[i] as Date)
      if (week.length === 7 || i === days.length - 1) {
        result.push(week)
        week = []
      }
    }
    return result
  }, [days])

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  const [isMounted, setIsMounted] = useState(false)
  const { contentRef, getVisibleEventCount } = useEventVisibility({
    eventHeight: EventHeight,
    eventGap: EventGap,
  })

  useEffect(() => {
    setIsMounted(true)
  }, [])

  return (
    <div data-slot='month-view' className='contents'>
      <div className='border-border/70 grid grid-cols-7 border-b'>
        {weekdays.map((day) => (
          <div key={day} className='text-muted-foreground/70 py-2 text-center text-sm'>
            {day}
          </div>
        ))}
      </div>
      <div className='grid flex-1 auto-rows-fr'>
        {weeks.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} className='grid grid-cols-7 [&:last-child>*]:border-b-0'>
            {week.map((day, dayIndex) => {
              const dayEvents = getEventsForDay(events, day)
              const spanningEvents = getSpanningEventsForDay(events, day)
              const isCurrentMonth = isSameMonth(day, currentDate)
              const cellId = `month-cell-${day.toISOString()}`
              const allDayEvents = [...spanningEvents, ...dayEvents]
              const allEvents = getAllEventsForDay(events, day)

              const isReferenceCell = weekIndex === 0 && dayIndex === 0
              const visibleCount = isMounted ? getVisibleEventCount(allDayEvents.length) : undefined
              const hasMore = visibleCount !== undefined && allDayEvents.length > visibleCount
              const remainingCount = hasMore ? allDayEvents.length - visibleCount : 0

              return (
                <div
                  key={day.toString()}
                  className='group border-border/70 data-outside-cell:bg-muted/25 data-outside-cell:text-muted-foreground/70 border-r border-b last:border-r-0'
                  data-today={isToday(day) || undefined}
                  data-outside-cell={!isCurrentMonth || undefined}>
                  <DroppableCell
                    id={cellId}
                    date={day}
                    onClick={() => {
                      const startTime = new Date(day)
                      startTime.setHours(DefaultStartHour, 0, 0)
                      onSlotClick?.(startTime)
                    }}>
                    <div className='group-data-today:bg-primary group-data-today:text-primary-foreground mt-1 inline-flex size-6 items-center justify-center rounded-full text-sm'>
                      {format(day, 'd')}
                    </div>
                    <div
                      ref={isReferenceCell ? contentRef : null}
                      className='min-h-[calc((var(--event-height)+var(--event-gap))*2)] sm:min-h-[calc((var(--event-height)+var(--event-gap))*3)] lg:min-h-[calc((var(--event-height)+var(--event-gap))*4)]'>
                      {sortEvents(allDayEvents).map((event, index) => {
                        const eventStart = new Date(event.start)
                        const eventEnd = new Date(event.end)
                        const isFirstDay = isSameDay(day, eventStart)
                        const isLastDay = isSameDay(day, eventEnd)
                        const isHidden =
                          isMounted && visibleCount !== undefined && index >= visibleCount

                        if (!visibleCount) return null

                        if (!isFirstDay) {
                          // Site 1/3: spanning duplicate (keeps column alignment, invisible title unless renderEvent overrides).
                          return (
                            <div
                              key={`spanning-${event.id}-${day.toISOString().slice(0, 10)}`}
                              className='aria-hidden:hidden'
                              aria-hidden={isHidden ? 'true' : undefined}>
                              <EventItem
                                onClick={(e) => handleEventClick(event, e)}
                                event={event}
                                view='month'
                                isFirstDay={isFirstDay}
                                isLastDay={isLastDay}
                                renderEvent={renderEvent}>
                                <div className='invisible' aria-hidden={true}>
                                  {!event.allDay && (
                                    <span>{format(new Date(event.start), 'h:mm')} </span>
                                  )}
                                  {event.title}
                                </div>
                              </EventItem>
                            </div>
                          )
                        }

                        // Site 2/3: the real, draggable chip.
                        return (
                          <div
                            key={event.id}
                            className='aria-hidden:hidden'
                            aria-hidden={isHidden ? 'true' : undefined}>
                            <DraggableEvent
                              event={event}
                              view='month'
                              onClick={(e) => handleEventClick(event, e)}
                              isFirstDay={isFirstDay}
                              isLastDay={isLastDay}
                              renderEvent={renderEvent}
                            />
                          </div>
                        )
                      })}

                      {hasMore && (
                        <Popover modal>
                          <PopoverTrigger asChild>
                            <button
                              type='button'
                              className='focus-visible:border-ring focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 mt-[var(--event-gap)] flex h-[var(--event-height)] w-full items-center overflow-hidden px-1 text-left text-[10px] backdrop-blur-md transition outline-none select-none focus-visible:ring-[3px] sm:px-2 sm:text-xs'
                              onClick={(e) => e.stopPropagation()}>
                              <span>
                                + {remainingCount} <span className='max-sm:sr-only'>more</span>
                              </span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align='center'
                            className='max-w-52 p-3'
                            style={{ '--event-height': `${EventHeight}px` } as React.CSSProperties}>
                            <div className='space-y-2'>
                              <div className='text-sm font-medium'>{format(day, 'EEE d')}</div>
                              <div className='space-y-1'>
                                {sortEvents(allEvents).map((event) => {
                                  const eventStart = new Date(event.start)
                                  const eventEnd = new Date(event.end)
                                  const isFirstDay = isSameDay(day, eventStart)
                                  const isLastDay = isSameDay(day, eventEnd)

                                  // Site 3/3: overflow popover list.
                                  return (
                                    <EventItem
                                      key={event.id}
                                      onClick={(e) => handleEventClick(event, e)}
                                      event={event}
                                      view='month'
                                      isFirstDay={isFirstDay}
                                      isLastDay={isLastDay}
                                      renderEvent={renderEvent}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </DroppableCell>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// packages/ui/src/components/event-calendar/week-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  addHours,
  eachDayOfInterval,
  eachHourOfInterval,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek,
} from 'date-fns'
import { useMemo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import { EndHour, StartHour, WeekCellsHeight } from './constants'
import { CurrentTimeLine } from './current-time-line'
import { DraggableEvent } from './draggable-event'
import { DroppableCell } from './droppable-cell'
import { EventItem } from './event-item'
import { useCurrentTimeIndicator } from './hooks/use-current-time-indicator'
import { HourGutter } from './hour-gutter'
import { positionEventsForDay } from './position-events'
import type { BackgroundEvent, EventCalendarItem, RenderEvent } from './types'
import { isMultiDayEvent } from './utils'

interface WeekViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  backgroundEvents?: BackgroundEvent[]
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  onEventResize?: (event: T, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
}

export function WeekView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  weekStartsOn,
  backgroundEvents = [],
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
}: WeekViewProps<T>) {
  const days = useMemo(() => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn })
    const weekEnd = endOfWeek(currentDate, { weekStartsOn })
    return eachDayOfInterval({ start: weekStart, end: weekEnd })
  }, [currentDate, weekStartsOn])

  const weekStart = useMemo(
    () => startOfWeek(currentDate, { weekStartsOn }),
    [currentDate, weekStartsOn]
  )

  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate)
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1),
    })
  }, [currentDate])

  const allDayEvents = useMemo(() => {
    return events
      .filter((event) => event.allDay || isMultiDayEvent(event))
      .filter((event) => {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        return days.some(
          (day) =>
            isSameDay(day, eventStart) ||
            isSameDay(day, eventEnd) ||
            (day > eventStart && day < eventEnd)
        )
      })
  }, [events, days])

  const timedEventsByDay = useMemo(() => {
    return days.map((day) => {
      const dayEvents = events.filter((event) => {
        if (event.allDay || isMultiDayEvent(event)) return false
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        return (
          isSameDay(day, eventStart) ||
          isSameDay(day, eventEnd) ||
          (eventStart < day && eventEnd > day)
        )
      })
      return positionEventsForDay(dayEvents, day, {
        cellHeight: WeekCellsHeight,
        startHour: StartHour,
      })
    })
  }, [days, events])

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  const showAllDaySection = allDayEvents.length > 0
  const { currentTimePosition, currentTimeVisible, currentTimeLabel } = useCurrentTimeIndicator(
    currentDate,
    'week',
    weekStartsOn
  )

  return (
    <div data-slot='week-view' className='flex h-full flex-col'>
      <div className='bg-background/80 border-border/70 sticky top-0 z-30 grid grid-cols-8 border-b backdrop-blur-md'>
        <div className='text-muted-foreground/70 py-2 text-center text-sm'>
          <span className='max-[479px]:sr-only'>{format(new Date(), 'O')}</span>
        </div>
        {days.map((day) => (
          <div
            key={day.toString()}
            className='data-today:text-foreground text-muted-foreground/70 py-2 text-center text-sm data-today:font-medium'
            data-today={isToday(day) || undefined}>
            <span className='sm:hidden' aria-hidden='true'>
              {format(day, 'E')[0]} {format(day, 'd')}
            </span>
            <span className='max-sm:hidden'>{format(day, 'EEE dd')}</span>
          </div>
        ))}
      </div>

      {showAllDaySection && (
        <div className='border-border/70 bg-muted/50 border-b'>
          <div className='grid grid-cols-8'>
            <div className='border-border/70 relative'>
              <span className='text-muted-foreground/70 absolute bottom-0 left-0 h-6 w-full max-w-full pe-2 text-right text-[10px] sm:pe-4 sm:text-xs'>
                All day
              </span>
            </div>
            {days.map((day, dayIndex) => {
              const dayAllDayEvents = allDayEvents.filter((event) => {
                const eventStart = new Date(event.start)
                const eventEnd = new Date(event.end)
                return (
                  isSameDay(day, eventStart) ||
                  (day > eventStart && day < eventEnd) ||
                  isSameDay(day, eventEnd)
                )
              })

              return (
                <div
                  key={day.toString()}
                  className='relative space-y-1 p-1'
                  data-today={isToday(day) || undefined}>
                  {dayAllDayEvents.map((event) => {
                    const eventStart = new Date(event.start)
                    const eventEnd = new Date(event.end)
                    const isFirstDay = isSameDay(day, eventStart)
                    const isLastDay = isSameDay(day, eventEnd)
                    const isFirstVisibleDay = dayIndex === 0 && isBefore(eventStart, weekStart)
                    const shouldShowTitle = isFirstDay || isFirstVisibleDay

                    // Site 1/2: all-day lane pill.
                    return (
                      <EventItem
                        key={`spanning-${event.id}`}
                        onClick={(e) => handleEventClick(event, e)}
                        event={event}
                        view='week'
                        allDayLane
                        isFirstDay={isFirstDay}
                        isLastDay={isLastDay}
                        renderEvent={renderEvent}>
                        <div
                          className={cn('truncate', !shouldShowTitle && 'invisible')}
                          aria-hidden={!shouldShowTitle}>
                          {event.title}
                        </div>
                      </EventItem>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className='grid flex-1 grid-cols-8 overflow-hidden'>
        <HourGutter
          hours={hours}
          nowIndicator={
            currentTimeVisible
              ? { position: currentTimePosition, label: currentTimeLabel }
              : undefined
          }
        />

        {days.map((day, dayIndex) => (
          <div
            key={day.toString()}
            className='relative grid auto-cols-fr'
            data-today={isToday(day) || undefined}>
            <BackgroundEventsLayer
              events={backgroundEvents}
              day={day}
              cellHeight={WeekCellsHeight}
            />

            {(timedEventsByDay[dayIndex] ?? []).map((positioned) => (
              <div
                key={positioned.event.id}
                className='absolute z-10 px-0.5'
                style={{
                  top: `${positioned.top}px`,
                  height: `${positioned.height}px`,
                  left: `${positioned.left * 100}%`,
                  width: `${positioned.width * 100}%`,
                  zIndex: positioned.zIndex,
                }}
                onClick={(e) => e.stopPropagation()}>
                <div className='h-full w-full'>
                  {/* Site 2/2: timed grid chip. */}
                  <DraggableEvent
                    event={positioned.event}
                    view='week'
                    onClick={(e) => handleEventClick(positioned.event, e)}
                    showTime
                    height={positioned.height}
                    onResize={onEventResize}
                    renderEvent={renderEvent}
                  />
                </div>
              </div>
            ))}

            {currentTimeVisible && isToday(day) && (
              <CurrentTimeLine position={currentTimePosition} />
            )}

            {hours.map((hour) => {
              const hourValue = hour.getHours()
              return (
                <div
                  key={hour.toString()}
                  className='relative h-[var(--week-cells-height)] border-b border-border/70 last:border-b-0'>
                  {[0, 1, 2, 3].map((quarter) => {
                    const quarterHourTime = hourValue + quarter * 0.25
                    return (
                      <DroppableCell
                        key={`${hour.toString()}-${quarter}`}
                        id={`week-cell-${day.toISOString()}-${quarterHourTime}`}
                        date={day}
                        time={quarterHourTime}
                        className={cn(
                          'absolute h-[calc(var(--week-cells-height)/4)] w-full',
                          quarter === 0 && 'top-0',
                          quarter === 1 && 'top-[calc(var(--week-cells-height)/4)]',
                          quarter === 2 && 'top-[calc(var(--week-cells-height)/4*2)]',
                          quarter === 3 && 'top-[calc(var(--week-cells-height)/4*3)]'
                        )}
                        onClick={() => {
                          const startTime = new Date(day)
                          startTime.setHours(hourValue, quarter * 15)
                          onSlotClick?.(startTime)
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

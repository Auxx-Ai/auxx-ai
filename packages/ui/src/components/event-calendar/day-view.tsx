// packages/ui/src/components/event-calendar/day-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { addHours, eachHourOfInterval, format, isSameDay, startOfDay } from 'date-fns'
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

interface DayViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  backgroundEvents?: BackgroundEvent[]
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  onEventResize?: (event: T, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
}

/** Big date header — day + month bold, year regular, weekday name below. */
export function DayViewHeader({ currentDate }: { currentDate: Date }) {
  return (
    <div className='px-2 py-3 sm:px-4'>
      <div className='text-2xl font-bold'>
        {format(currentDate, 'd MMMM')}{' '}
        <span className='font-normal'>{format(currentDate, 'yyyy')}</span>
      </div>
      <div className='text-muted-foreground text-sm'>{format(currentDate, 'EEEE')}</div>
    </div>
  )
}

export function DayView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  backgroundEvents = [],
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
}: DayViewProps<T>) {
  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate)
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1),
    })
  }, [currentDate])

  const dayEvents = useMemo(() => {
    return events
      .filter((event) => {
        const eventStart = new Date(event.start)
        const eventEnd = new Date(event.end)
        return (
          isSameDay(currentDate, eventStart) ||
          isSameDay(currentDate, eventEnd) ||
          (currentDate > eventStart && currentDate < eventEnd)
        )
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  }, [currentDate, events])

  const allDayEvents = useMemo(
    () => dayEvents.filter((event) => event.allDay || isMultiDayEvent(event)),
    [dayEvents]
  )
  const timeEvents = useMemo(
    () => dayEvents.filter((event) => !event.allDay && !isMultiDayEvent(event)),
    [dayEvents]
  )

  const positionedEvents = useMemo(
    () =>
      positionEventsForDay(timeEvents, currentDate, {
        cellHeight: WeekCellsHeight,
        startHour: StartHour,
      }),
    [currentDate, timeEvents]
  )

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  const showAllDaySection = allDayEvents.length > 0
  const { currentTimePosition, currentTimeVisible, currentTimeLabel } = useCurrentTimeIndicator(
    currentDate,
    'day'
  )

  return (
    <div data-slot='day-view' className='flex h-full flex-col'>
      {showAllDaySection && (
        <div className='border-border/70 bg-muted/50 border-t'>
          <div className='grid grid-cols-[3rem_1fr] sm:grid-cols-[3.5rem_1fr]'>
            <div />
            <div className='relative space-y-1 p-1'>
              {allDayEvents.map((event) => {
                const eventStart = new Date(event.start)
                const eventEnd = new Date(event.end)
                const isFirstDay = isSameDay(currentDate, eventStart)
                const isLastDay = isSameDay(currentDate, eventEnd)

                // Site 1/2: all-day lane pill.
                return (
                  <EventItem
                    key={`spanning-${event.id}`}
                    onClick={(e) => handleEventClick(event, e)}
                    event={event}
                    view='day'
                    allDayLane
                    isFirstDay={isFirstDay}
                    isLastDay={isLastDay}
                    renderEvent={renderEvent}>
                    <div>{event.title}</div>
                  </EventItem>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className='grid flex-1 grid-cols-[3rem_1fr] overflow-hidden border-t border-border/70 sm:grid-cols-[3.5rem_1fr]'>
        <HourGutter
          hours={hours}
          nowIndicator={
            currentTimeVisible
              ? { position: currentTimePosition, label: currentTimeLabel }
              : undefined
          }
        />

        <div className='relative'>
          <BackgroundEventsLayer
            events={backgroundEvents}
            day={currentDate}
            cellHeight={WeekCellsHeight}
          />

          {positionedEvents.map((positioned) => (
            <div
              key={positioned.event.id}
              className='absolute z-10 px-0.5'
              style={{
                top: `${positioned.top}px`,
                height: `${positioned.height}px`,
                left: `${positioned.left * 100}%`,
                width: `${positioned.width * 100}%`,
                zIndex: positioned.zIndex,
              }}>
              <div className='h-full w-full'>
                {/* Site 2/2: timed grid chip. */}
                <DraggableEvent
                  event={positioned.event}
                  view='day'
                  onClick={(e) => handleEventClick(positioned.event, e)}
                  showTime
                  height={positioned.height}
                  onResize={onEventResize}
                  renderEvent={renderEvent}
                />
              </div>
            </div>
          ))}

          {currentTimeVisible && <CurrentTimeLine position={currentTimePosition} />}

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
                      id={`day-cell-${currentDate.toISOString()}-${quarterHourTime}`}
                      date={currentDate}
                      time={quarterHourTime}
                      className={cn(
                        'absolute h-[calc(var(--week-cells-height)/4)] w-full',
                        quarter === 0 && 'top-0',
                        quarter === 1 && 'top-[calc(var(--week-cells-height)/4)]',
                        quarter === 2 && 'top-[calc(var(--week-cells-height)/4*2)]',
                        quarter === 3 && 'top-[calc(var(--week-cells-height)/4*3)]'
                      )}
                      onClick={() => {
                        const startTime = new Date(currentDate)
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
      </div>
    </div>
  )
}

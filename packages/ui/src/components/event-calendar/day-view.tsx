// packages/ui/src/components/event-calendar/day-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { addHours, eachHourOfInterval, format, isSameDay, startOfDay } from 'date-fns'
import { useMemo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import { WeekCellsHeight } from './constants'
import { CurrentTimeLine } from './current-time-line'
import { DraggableEvent } from './draggable-event'
import { DropPreview } from './drop-preview'
import { DroppableCell } from './droppable-cell'
import { EventItem } from './event-item'
import { useCurrentTimeIndicator } from './hooks/use-current-time-indicator'
import { HourGutter } from './hour-gutter'
import { useHourWindow } from './hour-window-context'
import { positionEventsForDay } from './position-events'
import { useCalendarSelection } from './selection/calendar-selection-context'
import type { BackgroundEvent, EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'

interface DayViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  backgroundEvents?: BackgroundEvent[]
  onEventSelect: (event: T, e: React.MouseEvent) => void
  /** Plain empty-cell click — clear-only (plan 44); create lives on `onSlotDoubleClick`. */
  onSlotClick?: () => void
  /** Double-click an empty cell → create a default-duration event at that slot (plan 44). */
  onSlotDoubleClick?: (startTime: Date, e: React.MouseEvent) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
  /** Px-per-hour of the timed grid — the zoomable vertical scale. Defaults to `WeekCellsHeight`. */
  hourHeight?: number
}

/**
 * Big date header — day + month bold, year regular, weekday name below. Also the day-grab
 * target for plain (non-resource) day view: cmd/ctrl+click toggles every event on `currentDate`
 * into the selection (§3.2) — resource/timeline day views grab from their own in-stream date
 * labels instead (they render one per visible day, this header only ever shows one).
 */
export function DayViewHeader<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
}: {
  currentDate: Date
  /** Omit when this header isn't paired with a plain day view's event list (e.g. resource/timeline
   * pass their own date labels through instead) — the header then renders without day-grab. */
  events?: T[]
}) {
  const selection = useCalendarSelection()
  return (
    <div
      className='px-2 py-3 sm:px-4'
      onClick={(e) =>
        events &&
        selection.handleDayGrab(
          getAllEventsForDay(events, currentDate).map((ev) => ev.id),
          e
        )
      }>
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
  onSlotDoubleClick,
  onEventResize,
  renderEvent,
  selectedIds,
  hourHeight = WeekCellsHeight,
}: DayViewProps<T>) {
  const { start: windowStart, end: windowEnd } = useHourWindow()
  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate)
    return eachHourOfInterval({
      start: addHours(dayStart, windowStart),
      end: addHours(dayStart, windowEnd - 1),
    })
  }, [currentDate, windowStart, windowEnd])

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
        cellHeight: hourHeight,
        startHour: windowStart,
      }),
    [currentDate, timeEvents, hourHeight, windowStart]
  )

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event, e)
  }

  const showAllDaySection = allDayEvents.length > 0
  const { currentTimePosition, currentTimeVisible, currentTimeLabel } = useCurrentTimeIndicator(
    currentDate,
    'day'
  )

  return (
    <div data-slot='day-view' className='flex flex-col'>
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
                    isSelected={selectedIds?.has(event.id) ?? false}
                    renderEvent={renderEvent}>
                    <div>{event.title}</div>
                  </EventItem>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className='grid flex-1 grid-cols-[3rem_1fr] border-t border-border/70 sm:grid-cols-[3.5rem_1fr]'>
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
            cellHeight={hourHeight}
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
                  cellSize={hourHeight}
                  renderEvent={renderEvent}
                  isSelected={selectedIds?.has(positioned.event.id) ?? false}
                />
              </div>
            </div>
          ))}

          <DropPreview day={currentDate} cellHeight={hourHeight} />

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
                      onClick={() => onSlotClick?.()}
                      onDoubleClick={(e) => {
                        const startTime = new Date(currentDate)
                        startTime.setHours(hourValue, quarter * 15)
                        onSlotDoubleClick?.(startTime, e)
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

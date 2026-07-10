// packages/ui/src/components/event-calendar/resource-day-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { addHours, eachHourOfInterval, isSameDay, startOfDay } from 'date-fns'
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
import type { BackgroundEvent, CalendarResource, EventCalendarItem, RenderEvent } from './types'
import { isMultiDayEvent } from './utils'

interface ResourceDayViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  resources: CalendarResource[]
  backgroundEvents?: BackgroundEvent[]
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date, resourceId: string) => void
  onEventResize?: (event: T, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
}

/**
 * `resources` day mode — cloned from `WeekView`'s grid shell but with
 * columns = resources (workers) instead of days, filtered by
 * `event.resourceId`, and built on the same `positionEventsForDay` util.
 */
export function ResourceDayView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  resources,
  backgroundEvents = [],
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
}: ResourceDayViewProps<T>) {
  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate)
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1),
    })
  }, [currentDate])

  const dayEvents = useMemo(() => {
    return events.filter((event) => {
      const eventStart = new Date(event.start)
      const eventEnd = new Date(event.end)
      return (
        isSameDay(currentDate, eventStart) ||
        isSameDay(currentDate, eventEnd) ||
        (currentDate > eventStart && currentDate < eventEnd)
      )
    })
  }, [currentDate, events])

  const allDayEventsByResource = useMemo(() => {
    return resources.map((resource) =>
      dayEvents.filter(
        (event) => (event.allDay || isMultiDayEvent(event)) && event.resourceId === resource.id
      )
    )
  }, [dayEvents, resources])

  const timedEventsByResource = useMemo(() => {
    return resources.map((resource) => {
      const resourceEvents = dayEvents.filter(
        (event) => !event.allDay && !isMultiDayEvent(event) && event.resourceId === resource.id
      )
      return positionEventsForDay(resourceEvents, currentDate, {
        cellHeight: WeekCellsHeight,
        startHour: StartHour,
      })
    })
  }, [currentDate, dayEvents, resources])

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  const showAllDaySection = allDayEventsByResource.some((r) => r.length > 0)
  const { currentTimePosition, currentTimeVisible, currentTimeLabel } = useCurrentTimeIndicator(
    currentDate,
    'resource'
  )

  const gridColsStyle = { gridTemplateColumns: `repeat(${resources.length}, minmax(0, 1fr))` }

  return (
    <div data-slot='resource-day-view' className='flex flex-col'>
      <div className='bg-background/80 border-border/70 sticky top-0 z-30 flex border-b backdrop-blur-md'>
        <div className='w-12 shrink-0 sm:w-14' />
        <div className='grid flex-1' style={gridColsStyle}>
          {resources.map((resource) => (
            <div
              key={resource.id}
              className='text-muted-foreground/70 flex items-center justify-center gap-1.5 py-2 text-sm'>
              {resource.header ?? resource.label}
            </div>
          ))}
        </div>
      </div>

      {showAllDaySection && (
        <div className='border-border/70 bg-muted/50 flex border-b'>
          <div className='w-12 shrink-0 sm:w-14' />
          <div className='grid flex-1' style={gridColsStyle}>
            {resources.map((resource, index) => (
              <div key={resource.id} className='relative space-y-1 p-1'>
                {(allDayEventsByResource[index] ?? []).map((event) => (
                  // Resource all-day pills reuse the same `allDayLane` EventItem path.
                  <EventItem
                    key={`spanning-${event.id}`}
                    onClick={(e) => handleEventClick(event, e)}
                    event={event}
                    view='resource'
                    allDayLane
                    renderEvent={renderEvent}>
                    <div>{event.title}</div>
                  </EventItem>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className='flex flex-1'>
        <HourGutter
          hours={hours}
          nowIndicator={
            currentTimeVisible
              ? { position: currentTimePosition, label: currentTimeLabel }
              : undefined
          }
        />

        <div className='grid flex-1' style={gridColsStyle}>
          {resources.map((resource, resourceIndex) => (
            <div key={resource.id} className='relative border-l border-border/70 first:border-l-0'>
              <BackgroundEventsLayer
                events={backgroundEvents}
                day={currentDate}
                resourceId={resource.id}
                cellHeight={WeekCellsHeight}
              />

              {(timedEventsByResource[resourceIndex] ?? []).map((positioned) => (
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
                    <DraggableEvent
                      event={positioned.event}
                      view='resource'
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
                          id={`resource-cell-${resource.id}-${currentDate.toISOString()}-${quarterHourTime}`}
                          date={currentDate}
                          time={quarterHourTime}
                          resourceId={resource.id}
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
                            onSlotClick?.(startTime, resource.id)
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
    </div>
  )
}

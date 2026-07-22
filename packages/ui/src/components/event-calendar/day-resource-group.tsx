// packages/ui/src/components/event-calendar/day-resource-group.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { isSameDay, isToday } from 'date-fns'
import { memo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import { CurrentTimeLine } from './current-time-line'
import { DraggableEvent } from './draggable-event'
import { DropPreview } from './drop-preview'
import { DroppableCell } from './droppable-cell'
import { useHourWindow } from './hour-window-context'
import { positionEventsForDay } from './position-events'
import type { BackgroundEvent, CalendarResource, EventCalendarItem, RenderEvent } from './types'
import { isMultiDayEvent } from './utils'

interface DayResourceGroupProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Stream day index — the group derives its own date via `dayAt(index)`. */
  index: number
  /** Horizontal offset (px), content-space, from the scroll container's origin — includes the gutter. */
  x: number
  /** Rendered day-group width (px) = `K × colWidth`; its K worker columns split it evenly. */
  dayWidth: number
  /** Vertical offset (px) below the sticky header where the hour grid starts. */
  top: number
  dayAt: (index: number) => Date
  /** The K worker columns nested inside this day — identical set/order every day. */
  resources: CalendarResource[]
  hours: Date[]
  events: T[]
  backgroundEvents: BackgroundEvent[]
  onEventSelect: (event: T, e: React.MouseEvent) => void
  onSlotClick?: (startTime: Date, resourceId: string) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
  /** Current-time line position (% of the hour grid) — shared math, rendered only when `isToday(day)`. */
  currentTimePosition: number
  /** Px-per-hour of the timed grid — the zoomable vertical scale (scroll-stable; changes only on zoom). */
  hourHeight: number
}

/**
 * One rendered day in the resource-timeline stream — the `WeekDayColumn`
 * counterpart, but its render unit is a *group* of K worker sub-columns rather
 * than a single day column. Memoized: `ResourceTimelineView` re-renders on
 * every scroll frame (the virtualizer's own subscription drives it), and
 * groups are the expensive part (K × 96 droppable quarter-hour cells + per-
 * worker event positioning). Every prop here is scroll-stable for a given
 * `index`, so scrolling only mounts/unmounts groups at the window's edges.
 *
 * Computes its own `day` and does its own per-worker event filtering — the
 * caller never slices `events` per day, which is what keeps a single memoized
 * group stable across scroll frames. The group's left edge carries a hairline
 * day-boundary border; worker sub-columns keep the hairline inner border.
 */
function DayResourceGroupInner<T extends EventCalendarItem = EventCalendarItem>({
  index,
  x,
  dayWidth,
  top,
  dayAt,
  resources,
  hours,
  events,
  backgroundEvents,
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
  selectedIds,
  currentTimePosition,
  hourHeight,
}: DayResourceGroupProps<T>) {
  const { start: windowStart } = useHourWindow()
  const day = dayAt(index)
  const today = isToday(day)

  const dayEvents = events.filter((event) => {
    if (event.allDay || isMultiDayEvent(event)) return false
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    return (
      isSameDay(day, eventStart) || isSameDay(day, eventEnd) || (eventStart < day && eventEnd > day)
    )
  })

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event, e)
  }

  return (
    <div
      className='border-border/70 absolute border-l'
      style={{
        top,
        left: 0,
        width: dayWidth,
        height: hours.length * hourHeight,
        transform: `translateX(${x}px)`,
        display: 'grid',
        gridTemplateColumns: `repeat(${resources.length}, minmax(0, 1fr))`,
      }}
      data-today={today || undefined}>
      {resources.map((resource) => {
        const resourceEvents = dayEvents.filter((event) => event.resourceId === resource.id)
        const positioned = positionEventsForDay(resourceEvents, day, {
          cellHeight: hourHeight,
          startHour: windowStart,
        })
        return (
          <div key={resource.id} className='border-border/70 relative border-l first:border-l-0'>
            <BackgroundEventsLayer
              events={backgroundEvents}
              day={day}
              resourceId={resource.id}
              cellHeight={hourHeight}
            />

            {positioned.map((p) => (
              <div
                key={p.event.id}
                className='absolute z-10 px-0.5'
                style={{
                  top: `${p.top}px`,
                  height: `${p.height}px`,
                  left: `${p.left * 100}%`,
                  width: `${p.width * 100}%`,
                  zIndex: p.zIndex,
                }}
                onClick={(e) => e.stopPropagation()}>
                <div className='h-full w-full'>
                  <DraggableEvent
                    event={p.event}
                    view='resource'
                    onClick={(e) => handleEventClick(p.event, e)}
                    showTime
                    height={p.height}
                    onResize={onEventResize}
                    cellSize={hourHeight}
                    renderEvent={renderEvent}
                    isSelected={selectedIds?.has(p.event.id) ?? false}
                  />
                </div>
              </div>
            ))}

            <DropPreview day={day} resourceId={resource.id} cellHeight={hourHeight} />

            {today && <CurrentTimeLine position={currentTimePosition} />}

            {hours.map((hour) => {
              const hourValue = hour.getHours()
              return (
                <div
                  key={hour.toString()}
                  className='border-border/70 relative h-[var(--week-cells-height)] border-b last:border-b-0'>
                  {[0, 1, 2, 3].map((quarter) => {
                    const quarterHourTime = hourValue + quarter * 0.25
                    return (
                      <DroppableCell
                        key={`${hour.toString()}-${quarter}`}
                        id={`resource-cell-${resource.id}-${day.toISOString()}-${quarterHourTime}`}
                        date={day}
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
                          const startTime = new Date(day)
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
        )
      })}
    </div>
  )
}

// memo() drops the generic — the cast restores the generic call signature.
export const DayResourceGroup = memo(DayResourceGroupInner) as typeof DayResourceGroupInner

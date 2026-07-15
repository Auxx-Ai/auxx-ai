// packages/ui/src/components/event-calendar/week-day-column.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { isSameDay, isToday } from 'date-fns'
import { memo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import { StartHour, WeekCellsHeight } from './constants'
import { CurrentTimeLine } from './current-time-line'
import { DraggableEvent } from './draggable-event'
import { DropPreview } from './drop-preview'
import { DroppableCell } from './droppable-cell'
import { positionEventsForDay } from './position-events'
import type { BackgroundEvent, EventCalendarItem, RenderEvent } from './types'
import { isMultiDayEvent } from './utils'

interface WeekDayColumnProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Stream day index — the column derives its own date via `dayAt(index)`. */
  index: number
  /** Horizontal offset (px), content-space, from the scroll container's origin — includes the gutter. */
  x: number
  /** Rendered column width (px) — `(clientWidth − gutterWidth) / 7`. */
  dayWidth: number
  /** Vertical offset (px) below the sticky header where the hour grid starts. */
  top: number
  dayAt: (index: number) => Date
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  hours: Date[]
  events: T[]
  backgroundEvents: BackgroundEvent[]
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  /** Current-time line position (% of the hour grid) — shared math, rendered only when `isToday(day)`. */
  currentTimePosition: number
}

/**
 * One rendered day column in the week stream — the "month view rotated 90°"
 * counterpart to `MonthWeekRow`. Memoized: `WeekView` re-renders on every
 * scroll frame (the virtualizer's own subscription drives it), and columns
 * are the expensive part (event filtering/positioning × 96 droppable
 * quarter-hour cells). Every prop here is scroll-stable for a given `index`,
 * so scrolling only mounts/unmounts columns at the render window's edges.
 *
 * Computes its own `day` and does its own timed-event filtering — the caller
 * never slices `events` per day, which is what lets a single memoized column
 * stay stable across scroll frames.
 */
function WeekDayColumnInner<T extends EventCalendarItem = EventCalendarItem>({
  index,
  x,
  dayWidth,
  top,
  dayAt,
  weekStartsOn,
  hours,
  events,
  backgroundEvents,
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
  selectedEventId,
  currentTimePosition,
}: WeekDayColumnProps<T>) {
  const day = dayAt(index)
  const isWeekBoundary = day.getDay() === weekStartsOn

  const dayEvents = events.filter((event) => {
    if (event.allDay || isMultiDayEvent(event)) return false
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    return (
      isSameDay(day, eventStart) || isSameDay(day, eventEnd) || (eventStart < day && eventEnd > day)
    )
  })
  const positioned = positionEventsForDay(dayEvents, day, {
    cellHeight: WeekCellsHeight,
    startHour: StartHour,
  })

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  return (
    <div
      className={cn(
        'absolute border-l border-border/40',
        isWeekBoundary && 'border-l-2 border-border'
      )}
      style={{
        top,
        left: 0,
        width: dayWidth,
        height: hours.length * WeekCellsHeight,
        transform: `translateX(${x}px)`,
      }}
      data-today={isToday(day) || undefined}>
      <BackgroundEventsLayer events={backgroundEvents} day={day} cellHeight={WeekCellsHeight} />

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
              view='week'
              onClick={(e) => handleEventClick(p.event, e)}
              showTime
              height={p.height}
              onResize={onEventResize}
              renderEvent={renderEvent}
              isSelected={p.event.id === selectedEventId}
            />
          </div>
        </div>
      ))}

      <DropPreview day={day} />

      {isToday(day) && <CurrentTimeLine position={currentTimePosition} />}

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
  )
}

// memo() drops the generic — the cast restores the generic call signature.
export const WeekDayColumn = memo(WeekDayColumnInner) as typeof WeekDayColumnInner

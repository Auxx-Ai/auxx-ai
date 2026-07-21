// packages/ui/src/components/event-calendar/timeline-day-section.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { isSameDay, isToday } from 'date-fns'
import { memo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import {
  CurrentTimeLineClass,
  MinEventDurationMinutes,
  TimelineHourWidth,
  TimelineLaneHeight,
} from './constants'
import { DraggableEvent } from './draggable-event'
import { DropPreviewX } from './drop-preview'
import { DroppableCell } from './droppable-cell'
import type { BackgroundEvent, CalendarResource, EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'

/** Vertical gap (px) subtracted from a lane's full height so stacked chips show a hairline seam. */
const LaneGap = 2

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

interface TimelineDaySectionProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Stream day index — the section derives its own date via `dayAt(index)`. */
  index: number
  /** Horizontal offset (px), content-space, from the scroll container's origin — includes the rail. */
  x: number
  /** Rendered day-section width (px) = `windowHours × TimelineHourWidth`. */
  dayWidth: number
  /** Vertical offset (px) below the sticky header where the worker rows start. */
  top: number
  dayAt: (index: number) => Date
  /** The K worker rows nested inside this day — identical set/order every day. */
  resources: CalendarResource[]
  events: T[]
  backgroundEvents: BackgroundEvent[]
  /** Visible hour range (fractional hours) shared with the shell and `HourGutter`-style ticks. */
  hourWindow: { start: number; end: number }
  /** Per-resource row height (px), same index order as `resources` — identical every rendered day. */
  rowHeights: number[]
  /** Per-resource row top offset (px, prefix sum of `rowHeights`). */
  rowTops: number[]
  /**
   * Rendered section height (px) — `max(sum of rowHeights, viewport height below the header)`,
   * computed by the shell so the day grid (and its vertical day border) always fills the screen
   * even when a few worker rows don't.
   */
  bodyHeight: number
  /**
   * Event id → lane index, keyed by `${resourceId}|${dayISOString}` — lanes are assigned per
   * resource PER RENDERED DAY (a multi-day event can occupy a different lane on each day segment
   * it spans), so the outer key must include the day, not just the resource.
   */
  laneMapsByResource: Map<string, Map<string, number>>
  onEventSelect: (event: T) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  /** Fraction (0..1) of the hour window "now" falls at — `null` when outside the window. */
  nowPosition: number | null
}

/**
 * One rendered day in the horizontal timeline stream — the `DayResourceGroup` counterpart, but
 * time flows left→right instead of top→bottom: each of the K worker rows is a horizontal lane
 * stack rather than a vertical hour grid. Memoized: `HorizontalTimelineView` re-renders on every
 * scroll frame (the virtualizer's own subscription drives it), and sections are the expensive
 * part (K rows × up to ~windowHours×4 droppable quarter-hour cells + per-worker event
 * positioning). Every prop here is scroll-stable for a given `index`, so scrolling only
 * mounts/unmounts sections at the window's edges.
 *
 * Computes its own `day` and does its own per-worker event filtering — the caller never slices
 * `events` per day, which is what keeps a single memoized section stable across scroll frames.
 * The section's left edge carries a hairline day-boundary border; worker rows keep a hairline
 * bottom border.
 */
function TimelineDaySectionInner<T extends EventCalendarItem = EventCalendarItem>({
  index,
  x,
  dayWidth,
  top,
  dayAt,
  resources,
  events,
  backgroundEvents,
  hourWindow,
  rowHeights,
  rowTops,
  bodyHeight,
  laneMapsByResource,
  onEventSelect,
  onEventResize,
  renderEvent,
  selectedEventId,
  nowPosition,
}: TimelineDaySectionProps<T>) {
  const day = dayAt(index)
  const dayIso = day.toISOString()
  const today = isToday(day)
  const { start: windowStart, end: windowEnd } = hourWindow
  const windowHours = Math.max(0, windowEnd - windowStart)
  const minChipWidth = (MinEventDurationMinutes / 60) * TimelineHourWidth
  const slotCount = windowHours > 0 ? Math.round(windowHours * 4) : 0

  // Timed single-day events touching this day — same overlap filter as `DayResourceGroup`.
  const dayEvents = events.filter((event) => {
    if (event.allDay || isMultiDayEvent(event)) return false
    const eventStart = new Date(event.start)
    const eventEnd = new Date(event.end)
    return (
      isSameDay(day, eventStart) || isSameDay(day, eventEnd) || (eventStart < day && eventEnd > day)
    )
  })
  const spanningCandidates = events.filter((event) => event.allDay || isMultiDayEvent(event))
  const spanningDayEvents = getAllEventsForDay(spanningCandidates, day)

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  return (
    <div
      className='border-border/70 absolute border-l'
      style={{
        top,
        left: 0,
        width: dayWidth,
        height: bodyHeight,
        transform: `translateX(${x}px)`,
      }}
      data-today={today || undefined}>
      {resources.map((resource, ri) => {
        const rowTop = rowTops[ri] ?? 0
        const rowHeight = rowHeights[ri] ?? TimelineLaneHeight
        const laneMap = laneMapsByResource.get(`${resource.id}|${dayIso}`)

        const resourceTimedEvents = dayEvents.filter((event) => event.resourceId === resource.id)
        const resourceSpanningEvents = spanningDayEvents.filter(
          (event) => event.resourceId === resource.id
        )

        return (
          <div
            key={resource.id}
            className='border-border/40 absolute border-b'
            style={{ top: rowTop, left: 0, width: dayWidth, height: rowHeight }}>
            <BackgroundEventsLayer
              events={backgroundEvents}
              day={day}
              resourceId={resource.id}
              cellHeight={TimelineLaneHeight}
              orientation='x'
              windowStartHour={windowStart}
              windowEndHour={windowEnd}
            />

            {resourceSpanningEvents.map((event) => {
              const lane = laneMap?.get(event.id) ?? 0
              const eventStart = new Date(event.start)
              const eventEnd = new Date(event.end)
              const isFirstDay = isSameDay(day, eventStart)
              const isLastDay = isSameDay(day, eventEnd)
              return (
                <div
                  key={`span-${event.id}`}
                  className='absolute z-10 px-0.5'
                  style={{
                    top: lane * TimelineLaneHeight,
                    left: 0,
                    width: dayWidth,
                    height: TimelineLaneHeight - LaneGap,
                  }}
                  onClick={(e) => e.stopPropagation()}>
                  <DraggableEvent
                    event={event}
                    view='resource'
                    orientation='x'
                    onClick={(e) => handleEventClick(event, e)}
                    showTime
                    height={TimelineLaneHeight - LaneGap}
                    width={dayWidth}
                    onResize={onEventResize}
                    renderEvent={renderEvent}
                    isSelected={event.id === selectedEventId}
                    isFirstDay={isFirstDay}
                    isLastDay={isLastDay}
                  />
                </div>
              )
            })}

            {windowHours > 0 &&
              resourceTimedEvents.map((event) => {
                const eventStart = new Date(event.start)
                const eventEnd = new Date(event.end)
                const startHourFloat = eventStart.getHours() + eventStart.getMinutes() / 60
                const endHourFloat = eventEnd.getHours() + eventEnd.getMinutes() / 60
                const clampedStart = clamp(startHourFloat, windowStart, windowEnd)
                const clampedEnd = clamp(endHourFloat, windowStart, windowEnd)
                if (clampedEnd <= clampedStart) return null

                // Clamped to the window edge — squares off that edge (via isFirstDay/isLastDay,
                // reusing the multi-day chip end-cap styling) as the "there's more outside the
                // window" indicator called for by the plan.
                const isClampedStart = startHourFloat < windowStart
                const isClampedEnd = endHourFloat > windowEnd
                const left = (clampedStart - windowStart) * TimelineHourWidth
                const width = Math.max(
                  (clampedEnd - clampedStart) * TimelineHourWidth,
                  minChipWidth
                )
                const lane = laneMap?.get(event.id) ?? 0

                return (
                  <div
                    key={event.id}
                    className='absolute z-10 px-0.5'
                    style={{
                      top: lane * TimelineLaneHeight,
                      left,
                      height: TimelineLaneHeight - LaneGap,
                    }}
                    onClick={(e) => e.stopPropagation()}>
                    <DraggableEvent
                      event={event}
                      view='resource'
                      orientation='x'
                      onClick={(e) => handleEventClick(event, e)}
                      showTime
                      height={TimelineLaneHeight - LaneGap}
                      width={width}
                      onResize={onEventResize}
                      renderEvent={renderEvent}
                      isSelected={event.id === selectedEventId}
                      isFirstDay={!isClampedStart}
                      isLastDay={!isClampedEnd}
                    />
                  </div>
                )
              })}

            <DropPreviewX
              day={day}
              resourceId={resource.id}
              windowStartHour={windowStart}
              windowEndHour={windowEnd}
            />

            {/* Quarter-hour droppable cells — no `onClick`, click-to-create is out of scope. */}
            {Array.from({ length: slotCount }, (_, slot) => {
              const quarterHourTime = windowStart + slot * 0.25
              return (
                <div
                  key={slot}
                  className='absolute top-0'
                  style={{
                    left: slot * (TimelineHourWidth / 4),
                    width: TimelineHourWidth / 4,
                    height: rowHeight,
                  }}>
                  <DroppableCell
                    id={`timeline-cell-${resource.id}-${dayIso}-${quarterHourTime}`}
                    date={day}
                    time={quarterHourTime}
                    resourceId={resource.id}
                  />
                </div>
              )
            })}
          </div>
        )
      })}

      {today && nowPosition !== null && (
        <div
          className={cn('pointer-events-none absolute inset-y-0 z-20 w-px', CurrentTimeLineClass)}
          style={{ left: `${nowPosition * 100}%` }}
        />
      )}
    </div>
  )
}

// memo() drops the generic — the cast restores the generic call signature.
export const TimelineDaySection = memo(TimelineDaySectionInner) as typeof TimelineDaySectionInner

// packages/ui/src/components/event-calendar/timeline-day-section.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { isSameDay, isToday } from 'date-fns'
import { memo } from 'react'

import { BackgroundEventsLayer } from './background-events'
import {
  CurrentTimeLineClass,
  MinEventDurationMinutes,
  TimelineLaneGap,
  TimelineRowPadding,
} from './constants'
import { DraggableEvent } from './draggable-event'
import { DropPreviewX } from './drop-preview'
import { DroppableCell } from './droppable-cell'
import type { BackgroundEvent, CalendarResource, EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Per-resource-per-day lane assignment — the map plus its lane count (row-centering needs it). */
export interface DayLaneAssignment {
  lanes: Map<string, number>
  laneCount: number
}

interface TimelineDaySectionProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Stream day index — the section derives its own date via `dayAt(index)` AND its own x
   * position via `calc(var(--tl-rail-width) + index × var(--tl-day-width) + var(--tl-zoom-comp))`
   * (plan 35 §5.4 — index-based positioning keeps section props stable across scroll AND zoom). */
  index: number
  /** Vertical offset (px) below the sticky header where the worker rows start. */
  top: number
  dayAt: (index: number) => Date
  /** The K worker rows nested inside this day — identical set/order every day. */
  resources: CalendarResource[]
  events: T[]
  backgroundEvents: BackgroundEvent[]
  /** Visible hour range (fractional hours) shared with the shell and `HourGutter`-style ticks. */
  hourWindow: { start: number; end: number }
  /** COMMITTED px-per-hour — feeds the resize hook's px→minutes math only; all layout inside the
   * section is day-percentages, so mid-gesture zoom never needs this to update. */
  hourWidth: number
  /** COMMITTED lane height (px) — feeds the drag ghost's measured height only; all vertical
   * layout inside the section is `calc()` over `--tl-lane-height` (plan 43), so a mid-gesture
   * lane drag never needs this to update. */
  laneHeight: number
  /** Per-resource max lane count, same index order as `resources` — identical every rendered day. */
  rowLaneCounts: number[]
  /** Per-resource lane-count prefix sum — row tops derive from it via `--tl-lane-height`. */
  rowLaneStarts: number[]
  /**
   * Rendered section height (a CSS `max()`/`calc()` expression over `--tl-lane-height`) —
   * computed by the shell so the day grid (and its vertical day border) always fills the screen
   * even when a few worker rows don't.
   */
  bodyHeight: string
  /**
   * Lane assignment keyed by `${resourceId}|${dayISOString}` — lanes are assigned per resource
   * PER RENDERED DAY (a multi-day event can occupy a different lane on each day segment it
   * spans), so the outer key must include the day, not just the resource.
   */
  laneMapsByResource: Map<string, DayLaneAssignment>
  onEventSelect: (event: T, e: React.MouseEvent) => void
  /** Plain empty-cell click — clear-only (plan 44); create lives on `onSlotDoubleClick`. */
  onSlotClick?: () => void
  /** Double-click an empty cell → create a default-duration event at that slot/worker (plan 44). */
  onSlotDoubleClick?: (startTime: Date, resourceId: string, e: React.MouseEvent) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
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
 * All horizontal geometry inside the section is expressed in PERCENTAGES of the section, and the
 * section's own width/x come from the `--tl-day-width`/`--tl-rail-width`/`--tl-zoom-comp` CSS
 * variables (plan 35 §5.4) — so a zoom or rail-resize gesture restyles the whole section tree
 * with two style-property writes and ZERO section re-renders.
 *
 * Computes its own `day` and does its own per-worker event filtering — the caller never slices
 * `events` per day, which is what keeps a single memoized section stable across scroll frames.
 * The section's left edge carries a hairline day-boundary border; worker rows keep a hairline
 * bottom border.
 */
function TimelineDaySectionInner<T extends EventCalendarItem = EventCalendarItem>({
  index,
  top,
  dayAt,
  resources,
  events,
  backgroundEvents,
  hourWindow,
  hourWidth,
  laneHeight,
  rowLaneCounts,
  rowLaneStarts,
  bodyHeight,
  laneMapsByResource,
  onEventSelect,
  onSlotClick,
  onSlotDoubleClick,
  onEventResize,
  renderEvent,
  selectedIds,
  nowPosition,
}: TimelineDaySectionProps<T>) {
  const day = dayAt(index)
  const dayIso = day.toISOString()
  const today = isToday(day)
  const { start: windowStart, end: windowEnd } = hourWindow
  const windowHours = Math.max(0, windowEnd - windowStart)
  const minChipWidthPct = windowHours > 0 ? (MinEventDurationMinutes / 60 / windowHours) * 100 : 0
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
    onEventSelect(event, e)
  }

  return (
    <div
      className='border-border/70 absolute border-l'
      style={{
        top,
        left: 0,
        width: 'var(--tl-day-width)',
        height: bodyHeight,
        transform: `translateX(calc(var(--tl-rail-width) + ${index} * var(--tl-day-width) + var(--tl-zoom-comp, 0px)))`,
      }}
      data-today={today || undefined}>
      {resources.map((resource, ri) => {
        const rowLanes = rowLaneCounts[ri] ?? 1
        // All vertical geometry is calc() over `--tl-lane-height` with gesture-stable lane-count
        // multipliers (plan 43) — a live lane-height drag restyles every row/chip with one CSS-var
        // write and zero section re-renders (the plan-35 §5.4 trick, rotated to the y-axis).
        const rowTop = `calc(${rowLaneStarts[ri] ?? 0} * var(--tl-lane-height) + ${
          ri * TimelineRowPadding
        }px)`
        const rowHeight = `calc(${rowLanes} * var(--tl-lane-height) + ${TimelineRowPadding}px)`
        const assignment = laneMapsByResource.get(`${resource.id}|${dayIso}`)
        const laneMap = assignment?.lanes
        const dayLanes = Math.max(1, assignment?.laneCount ?? 1)
        // Center THIS day's lane stack in the (window-max-sized) row — a lone chip on a worker
        // whose row is tall because of a stacked day elsewhere sits centered, not top-pinned.
        // (`dayLanes ≤ rowLanes` always, so the un-clamped expression is never negative.)
        const chipTop = (lane: number) =>
          `calc((${rowLanes - dayLanes} * var(--tl-lane-height) + ${
            TimelineRowPadding + TimelineLaneGap
          }px) / 2 + ${lane} * var(--tl-lane-height))`
        const chipHeight = `calc(var(--tl-lane-height) - ${TimelineLaneGap}px)`

        const resourceTimedEvents = dayEvents.filter((event) => event.resourceId === resource.id)
        const resourceSpanningEvents = spanningDayEvents.filter(
          (event) => event.resourceId === resource.id
        )

        return (
          <div
            key={resource.id}
            className='border-border/40 absolute right-0 left-0 border-b'
            style={{ top: rowTop, height: rowHeight }}>
            <BackgroundEventsLayer
              events={backgroundEvents}
              day={day}
              resourceId={resource.id}
              cellHeight={laneHeight}
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
                  className='absolute right-0 left-0 z-10 px-0.5'
                  style={{
                    top: chipTop(lane),
                    height: chipHeight,
                  }}
                  onClick={(e) => e.stopPropagation()}>
                  <DraggableEvent
                    event={event}
                    view='resource'
                    orientation='x'
                    cellSize={hourWidth}
                    onClick={(e) => handleEventClick(event, e)}
                    showTime
                    height={laneHeight - TimelineLaneGap}
                    onResize={onEventResize}
                    renderEvent={renderEvent}
                    isSelected={selectedIds?.has(event.id) ?? false}
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
                const leftPct = ((clampedStart - windowStart) / windowHours) * 100
                const widthPct = Math.max(
                  ((clampedEnd - clampedStart) / windowHours) * 100,
                  minChipWidthPct
                )
                const lane = laneMap?.get(event.id) ?? 0

                return (
                  <div
                    key={event.id}
                    className='absolute z-10 px-0.5'
                    style={{
                      top: chipTop(lane),
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: chipHeight,
                    }}
                    onClick={(e) => e.stopPropagation()}>
                    <DraggableEvent
                      event={event}
                      view='resource'
                      orientation='x'
                      cellSize={hourWidth}
                      onClick={(e) => handleEventClick(event, e)}
                      showTime
                      height={laneHeight - TimelineLaneGap}
                      onResize={onEventResize}
                      renderEvent={renderEvent}
                      isSelected={selectedIds?.has(event.id) ?? false}
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

            {/* Quarter-hour droppable cells — clicking one reports the already-computed
                day/quarterHourTime/resourceId as a slot click (§7), through the same
                clear-selection-first ordering every other view's cells share. */}
            {Array.from({ length: slotCount }, (_, slot) => {
              const quarterHourTime = windowStart + slot * 0.25
              return (
                <div
                  key={slot}
                  className='absolute top-0'
                  style={{
                    left: `${(slot / slotCount) * 100}%`,
                    width: `${100 / slotCount}%`,
                    height: rowHeight,
                  }}>
                  <DroppableCell
                    id={`timeline-cell-${resource.id}-${dayIso}-${quarterHourTime}`}
                    date={day}
                    time={quarterHourTime}
                    resourceId={resource.id}
                    axis='x'
                    onClick={() => onSlotClick?.()}
                    onDoubleClick={(e) => {
                      const hours = Math.floor(quarterHourTime)
                      const minutes = Math.round((quarterHourTime - hours) * 60)
                      const startTime = new Date(day)
                      startTime.setHours(hours, minutes, 0, 0)
                      onSlotDoubleClick?.(startTime, resource.id, e)
                    }}
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

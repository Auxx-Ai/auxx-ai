// packages/ui/src/components/event-calendar/horizontal-timeline-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  addDays,
  addHours,
  differenceInCalendarDays,
  endOfDay,
  format,
  isSameDay,
  isToday,
  startOfDay,
} from 'date-fns'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { assignLanes } from './assign-lanes'
import {
  CurrentTimeLabelClass,
  StreamEndYear,
  StreamStartYear,
  TimelineHourWidth,
  TimelineLaneHeight,
  TimelineRailWidth,
} from './constants'
import { TimelineDaySection } from './timeline-day-section'
import type {
  BackgroundEvent,
  CalendarResource,
  EventCalendarItem,
  RenderEvent,
  TimelineHourWindow,
} from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'

/** Height (px) of the sticky date-label row (row 1 of the two-tier header) — matches `ResourceTimelineView`. */
const DateLabelHeight = 32

/** Height (px) of the hour-tick row (row 2 of the two-tier header). */
const HourTickHeight = 24

/** Extra padding (px) added on top of `maxLanes * TimelineLaneHeight` when sizing a worker row. */
const RowPadding = 8

/** Stable empty default — an inline `[]` would break `TimelineDaySection`'s memo every scroll frame. */
const NoBackgroundEvents: BackgroundEvent[] = []

interface HorizontalTimelineViewProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Scroll target = the literal leftmost visible day (no `startOfWeek` normalization). */
  currentDate: Date
  events: T[]
  /** The K worker rows rendered inside every rendered day. */
  resources: CalendarResource[]
  /** Unused — kept for prop-signature symmetry with `ResourceTimelineView`. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  backgroundEvents?: BackgroundEvent[]
  /** Visible hour range — `dayWidth` derives from this, not from a viewport clamp. */
  hourWindow: TimelineHourWindow
  onEventSelect: (event: T) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  /** Fires when a user scroll settles on a new leftmost day. */
  onDateChange?: (date: Date) => void
  /** Fires with the rendered (visible + overscan) day window — consumers fetch this. */
  onVisibleRangeChange?: (from: Date, to: Date) => void
}

/**
 * The horizontal dispatch-board timeline — worker rows × hours, time flowing left→right. Same
 * epoch/virtualizer day-stream shell as `ResourceTimelineView` (this IS `WeekView`/
 * `ResourceTimelineView`'s architecture, just rotated 90°): the virtualizer still counts days,
 * the sizing/settle-snap/scroll-anchor machinery is lifted near-verbatim. The differences are all
 * in what a rendered "day" looks like: instead of K vertical worker sub-columns inside an hour
 * grid, each day is `windowHours × TimelineHourWidth` wide and contains K horizontal worker rows
 * whose lane stacks (see `assignLanes`) can grow taller when visits overlap.
 *
 * `dayWidth` is window-derived (`windowHours × TimelineHourWidth`), NOT clamp-derived — the
 * sizing effect only measures how much width is available (`avail`) to decide whether a full day
 * fits (`snapEnabled`); it never shrinks `dayWidth` itself the way `ResourceTimelineView`'s hybrid
 * clamp does.
 */
export function HorizontalTimelineView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  resources,
  weekStartsOn: _weekStartsOn,
  backgroundEvents = NoBackgroundEvents,
  hourWindow,
  onEventSelect,
  onEventResize,
  renderEvent,
  selectedEventId,
  onDateChange,
  onVisibleRangeChange,
}: HorizontalTimelineViewProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [viewportHeight, setViewportHeight] = useState(0)

  const windowStart = hourWindow.start
  const windowEnd = hourWindow.end
  const windowHours = Math.max(0, windowEnd - windowStart)
  const dayWidth = Math.max(1, windowHours * TimelineHourWidth)

  const { epoch, dayCount } = useMemo(() => {
    const start = startOfDay(new Date(StreamStartYear, 0, 1))
    const count = differenceInCalendarDays(new Date(StreamEndYear, 0, 1), start) + 1
    return { epoch: start, dayCount: count }
  }, [])

  const dayAt = useCallback((index: number) => addDays(epoch, index), [epoch])

  const dayIndexOf = useCallback(
    (date: Date) => Math.min(dayCount - 1, Math.max(0, differenceInCalendarDays(date, epoch))),
    [epoch, dayCount]
  )

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: dayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => dayWidth, [dayWidth]),
    overscan: 1,
  })

  // ── sizing: dayWidth is window-derived (see above) — this effect only measures how much width
  // is available beside the fixed-width rail, to decide whether a full day fits (snapEnabled).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const applySize = () => {
      const avail = Math.max(1, el.clientWidth - TimelineRailWidth)
      setSnapEnabled(dayWidth <= avail)
      // Body min-height: the row/day grid stretches to fill the viewport even with few workers.
      setViewportHeight(el.clientHeight)
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [dayWidth])

  // Layout effect, declared BEFORE the scroll-to effect below: the virtualizer's measurement
  // cache must reflect the new day width before anything scrolls by it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when dayWidth changes
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [dayWidth, virtualizer])

  // ── currentDate → scroll ─────────────────────────────────────────────────
  const targetIndex = dayIndexOf(currentDate)
  const programmaticScrollRef = useRef(false)
  const currentDateRef = useRef(currentDate)
  currentDateRef.current = currentDate
  // Set when a scroll-settle emits onDateChange — that date echoing back as the `currentDate`
  // prop must NOT re-scroll (the user is already looking at it).
  const lastEmittedDateRef = useRef<number | null>(null)
  const lastDayWidthRef = useRef(dayWidth)
  const lastScrollLeftRef = useRef(0)

  useLayoutEffect(() => {
    const dayWidthChanged = lastDayWidthRef.current !== dayWidth
    if (!dayWidthChanged && lastEmittedDateRef.current === currentDateRef.current.getTime()) return
    const el = scrollRef.current
    if (!el) return
    lastDayWidthRef.current = dayWidth
    programmaticScrollRef.current = true
    const targetOffset = targetIndex * dayWidth
    el.scrollTo({ left: targetOffset })
    lastScrollLeftRef.current = targetOffset
    const timeout = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 300)
    return () => clearTimeout(timeout)
  }, [targetIndex, dayWidth])

  // ── scroll → snap → currentDate ──────────────────────────────────────────
  // Same JS settle-snap as week/resource-timeline. This container scrolls BOTH axes — the settle
  // handler compares scrollLeft against its value from before this gesture and skips when
  // unchanged, so a pure vertical scroll never yanks sideways. Snapping is GUARDED by
  // snapEnabled: when a day is wider than the viewport (the common case at this width) we skip
  // the snap-scroll but still emit the (rounded) leftmost day.
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const handleScroll = useCallback(() => {
    clearTimeout(settleTimeoutRef.current)
    settleTimeoutRef.current = setTimeout(() => {
      if (programmaticScrollRef.current) return
      const el = scrollRef.current
      if (!el) return
      const { scrollLeft } = el
      if (scrollLeft === lastScrollLeftRef.current) return
      lastScrollLeftRef.current = scrollLeft

      const snapIndex = Math.min(dayCount - 1, Math.max(0, Math.round(scrollLeft / dayWidth)))
      if (snapEnabled) {
        const snapOffset = snapIndex * dayWidth
        if (Math.abs(scrollLeft - snapOffset) > 2) {
          el.scrollTo({ left: snapOffset, behavior: 'smooth' })
          return // the smooth scroll re-settles here, aligned
        }
      }
      const leftmost = dayAt(snapIndex)
      if (!isSameDay(leftmost, currentDateRef.current)) {
        lastEmittedDateRef.current = leftmost.getTime()
        onDateChange?.(leftmost)
      }
    }, 160)
  }, [dayCount, dayWidth, dayAt, onDateChange, snapEnabled])

  useEffect(() => () => clearTimeout(settleTimeoutRef.current), [])

  // ── visible window → consumer fetch range ────────────────────────────────
  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index
  const lastIndex = virtualItems[virtualItems.length - 1]?.index

  useEffect(() => {
    if (firstIndex === undefined || lastIndex === undefined) return
    // End-inclusive `to` (endOfDay), matching the week/month/resource stream convention.
    onVisibleRangeChange?.(dayAt(firstIndex), endOfDay(dayAt(lastIndex)))
  }, [firstIndex, lastIndex, dayAt, onVisibleRangeChange])

  // ── row geometry: lanes per worker per rendered day ──────────────────────
  // `assignLanes` runs per resource per RENDERED day (all-day/multi-day events participate as
  // synthetic full-window intervals for that day) so overlap stacking never straddles a day
  // boundary. `maxLanes` is the max across the rendered window so a row's height doesn't change
  // while scrolling within it (it may still shift when scrolling INTO a differently-stacked day
  // — same accepted-v1 precedent as the vertical streams' all-day lane).
  //
  // Lane maps are keyed `${resourceId}|${dayISOString}` (not just `resourceId`): a multi-day
  // event can land in a different lane on each day segment it spans, so the day must be part of
  // the key — see `TimelineDaySection`'s doc comment.
  const { rowHeights, rowTops, laneMapsByResource } = useMemo(() => {
    const laneMapsByResource = new Map<string, Map<string, number>>()
    const rowHeights: number[] = []

    for (const resource of resources) {
      let maxLanes = 1
      if (firstIndex !== undefined && lastIndex !== undefined) {
        const resourceEvents = events.filter((event) => event.resourceId === resource.id)
        const timedEvents = resourceEvents.filter(
          (event) => !event.allDay && !isMultiDayEvent(event)
        )
        const spanningEvents = resourceEvents.filter(
          (event) => event.allDay || isMultiDayEvent(event)
        )

        for (let i = firstIndex; i <= lastIndex; i++) {
          const day = dayAt(i)
          const dayStart = startOfDay(day)
          const dayWinStart = addHours(dayStart, windowStart)
          const dayWinEnd = addHours(dayStart, windowEnd)

          const dayTimedEvents = timedEvents.filter((event) => {
            const eventStart = new Date(event.start)
            const eventEnd = new Date(event.end)
            return (
              isSameDay(day, eventStart) ||
              isSameDay(day, eventEnd) ||
              (eventStart < day && eventEnd > day)
            )
          })
          // Multi-day/all-day events occupy a full-window synthetic interval for THIS day, so
          // they claim a whole lane alongside timed events rather than being ignored by
          // `assignLanes` (which only reads `.start`/`.end`).
          const daySpanningEvents = getAllEventsForDay(spanningEvents, day).map((event) => ({
            ...event,
            start: dayWinStart,
            end: dayWinEnd,
          }))

          const { lanes, laneCount } = assignLanes([...dayTimedEvents, ...daySpanningEvents])
          laneMapsByResource.set(`${resource.id}|${day.toISOString()}`, lanes)
          if (laneCount > maxLanes) maxLanes = laneCount
        }
      }
      rowHeights.push(maxLanes * TimelineLaneHeight + RowPadding)
    }

    const rowTops: number[] = []
    let acc = 0
    for (const h of rowHeights) {
      rowTops.push(acc)
      acc += h
    }

    return { rowHeights, rowTops, laneMapsByResource }
  }, [resources, events, firstIndex, lastIndex, dayAt, windowStart, windowEnd])

  const totalRowsHeight = rowHeights.reduce((sum, h) => sum + h, 0)
  const headerHeight = DateLabelHeight + HourTickHeight
  // The body (rows + day sections + their vertical day borders) fills at least the visible
  // viewport below the header — the grid never stops short above empty screen space.
  const bodyHeight = Math.max(totalRowsHeight, viewportHeight - headerHeight)

  // ── current time: 60s-interval state, window-relative (NOT `useCurrentTimeIndicator`'s 24h-%
  // math — this view's x-axis is `hourWindow`, not the full day). The effect has an empty
  // dependency array so it's mount-stable, same intent as `resource-timeline-view`'s
  // `anchorNowRef` pattern (never torn down/recreated by scroll-driven re-renders).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  const nowPosition = useMemo(() => {
    if (windowHours <= 0) return null
    const hourFloat = now.getHours() + now.getMinutes() / 60
    if (hourFloat < windowStart || hourFloat > windowEnd) return null
    return (hourFloat - windowStart) / windowHours
  }, [now, windowStart, windowEnd, windowHours])

  const nowLabel = useMemo(() => format(now, 'h:mm a'), [now])

  const totalSize = virtualizer.getTotalSize()
  const hourTicks = windowHours > 0 ? Math.round(windowHours) : 0

  return (
    <div data-slot='horizontal-timeline-view' className='flex min-h-0 flex-1 flex-col'>
      <div ref={scrollRef} onScroll={handleScroll} className='min-h-0 flex-1 overflow-auto'>
        <div
          className='relative'
          style={{
            width: TimelineRailWidth + totalSize,
            minHeight: headerHeight + bodyHeight,
          }}>
          {/* Two-tier sticky header: date labels + hour ticks. */}
          <div
            className='bg-background/80 border-border/70 sticky top-0 z-30 border-b backdrop-blur-md'
            style={{ height: headerHeight }}>
            {/* Corner — sticky on both axes: pinned left within the (already sticky-top) strip. */}
            <div
              className='bg-background border-border/70 text-muted-foreground/70 sticky left-0 z-10 flex items-center justify-center border-r text-sm'
              style={{ width: TimelineRailWidth, height: headerHeight }}>
              <span className='max-[479px]:sr-only'>{format(new Date(), 'O')}</span>
            </div>

            {/* Row 1 — per-day date label, spanning the whole day-section width, centered. */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = TimelineRailWidth + v.start
              const today = isToday(day)
              return (
                <div
                  key={`label-${v.key}`}
                  className='text-muted-foreground/80 border-border/70 absolute flex items-center justify-center gap-1.5 border-l text-sm'
                  style={{
                    top: 0,
                    left: 0,
                    width: dayWidth,
                    height: DateLabelHeight,
                    transform: `translateX(${x}px)`,
                  }}>
                  <span className='uppercase'>{format(day, 'EEE')}</span>
                  {/* Today's date sits in a filled badge (Notion look); other days stay plain. */}
                  <span
                    className={cn(
                      'flex h-6 min-w-6 items-center justify-center rounded-full px-1 tabular-nums',
                      today
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground font-medium'
                    )}>
                    {format(day, 'd')}
                  </span>
                </div>
              )
            })}

            {/* Row 2 — hour tick labels every `TimelineHourWidth` px, plus the now-pill on today. */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = TimelineRailWidth + v.start
              const today = isToday(day)
              return (
                <div
                  key={`ticks-${v.key}`}
                  className='border-border/70 absolute border-l text-[10px]'
                  style={{
                    top: DateLabelHeight,
                    left: 0,
                    width: dayWidth,
                    height: HourTickHeight,
                    transform: `translateX(${x}px)`,
                  }}>
                  {Array.from({ length: hourTicks }, (_, hourIndex) => {
                    const tickDate = addHours(startOfDay(day), windowStart + hourIndex)
                    return (
                      <div
                        key={hourIndex}
                        className='border-border/50 text-muted-foreground/70 absolute top-0 h-full border-l pl-1 font-medium first:border-l-0'
                        style={{ left: hourIndex * TimelineHourWidth, width: TimelineHourWidth }}>
                        {format(tickDate, 'h a')}
                      </div>
                    )
                  })}
                  {today && nowPosition !== null && (
                    <div
                      className='pointer-events-none absolute top-0 z-20 -translate-x-1/2'
                      style={{ left: `${nowPosition * 100}%` }}>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap',
                          CurrentTimeLabelClass
                        )}>
                        {nowLabel}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Sticky-left worker rail — pinned left only (no `top`: it scrolls vertically with
              the rows below; its flow position already starts below the sticky header). */}
          <div
            className='bg-background sticky left-0 z-20 w-fit'
            style={{ width: TimelineRailWidth }}>
            <div className='relative' style={{ height: bodyHeight }}>
              {resources.map((resource, ri) => (
                <div
                  key={resource.id}
                  className='border-border/70 text-muted-foreground/80 absolute flex items-center border-b px-2 text-sm'
                  style={{
                    top: rowTops[ri] ?? 0,
                    left: 0,
                    width: TimelineRailWidth,
                    height: rowHeights[ri] ?? TimelineLaneHeight,
                  }}>
                  {resource.header ?? resource.label}
                </div>
              ))}
            </div>
          </div>

          {virtualItems.map((v) => (
            <TimelineDaySection
              key={v.key}
              index={v.index}
              x={TimelineRailWidth + v.start}
              dayWidth={dayWidth}
              top={headerHeight}
              dayAt={dayAt}
              resources={resources}
              events={events}
              backgroundEvents={backgroundEvents}
              hourWindow={hourWindow}
              rowHeights={rowHeights}
              rowTops={rowTops}
              bodyHeight={bodyHeight}
              laneMapsByResource={laneMapsByResource}
              onEventSelect={onEventSelect}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              selectedEventId={selectedEventId}
              nowPosition={nowPosition}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

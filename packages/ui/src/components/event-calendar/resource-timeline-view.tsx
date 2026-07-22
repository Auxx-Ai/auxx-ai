// packages/ui/src/components/event-calendar/resource-timeline-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  addDays,
  addHours,
  differenceInCalendarDays,
  eachHourOfInterval,
  endOfDay,
  format,
  isSameDay,
  isToday,
  startOfDay,
} from 'date-fns'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  EventGap,
  EventHeight,
  GridHeaderHeight,
  StreamEndYear,
  StreamStartYear,
  WeekCellsHeight,
} from './constants'
import { DayResourceGroup } from './day-resource-group'
import { EventItem } from './event-item'
import { useCurrentTimeIndicator } from './hooks/use-current-time-indicator'
import { HourGutter } from './hour-gutter'
import { useHourWindow } from './hour-window-context'
import { useCalendarSelection } from './selection/calendar-selection-context'
import { StickyRailShadow } from './sticky-rail-shadow'
import type { BackgroundEvent, CalendarResource, EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'

/** Height (px) of the sticky date-label row (row 1 of the two-tier header). */
const DateLabelHeight = 32

/** Height (px) of the worker sub-header row (row 2) — the lifted `resource-day-view` header grid. */
const WorkerHeaderHeight = GridHeaderHeight - DateLabelHeight

/** Minimum height (px) of the always-visible all-day lane, even with zero events — no pop-in. */
const AllDayLaneMinHeight = 32

/** Vertical padding (px, top+bottom) inside the all-day lane, mirrors the old cell's `p-1`. */
const AllDayLanePadding = 8

/** Worker-column floor (px) — the hybrid clamp never shrinks a sub-column below this. */
const MIN_COL_W = 72

/** Stable empty default — an inline `[]` would break `DayResourceGroup`'s memo every scroll frame. */
const NoBackgroundEvents: BackgroundEvent[] = []

interface ResourceTimelineViewProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Scroll target = the literal leftmost visible day (no `startOfWeek` normalization). */
  currentDate: Date
  events: T[]
  /** The K worker columns nested inside every rendered day. */
  resources: CalendarResource[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  backgroundEvents?: BackgroundEvent[]
  /** How many days to aim for across the viewport — 1 (Day mode) or e.g. 3 (Timeline mode). */
  desiredDays?: number
  onEventSelect: (event: T, e: React.MouseEvent) => void
  onSlotClick?: (startTime: Date, resourceId: string) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
  /** Fires when a user scroll settles on a new leftmost day. */
  onDateChange?: (date: Date) => void
  /** Fires with the rendered (visible + overscan) day window — consumers fetch this. */
  onVisibleRangeChange?: (from: Date, to: Date) => void
  /** Px-per-hour of the timed grid — the zoomable vertical scale. Defaults to `WeekCellsHeight`. */
  hourHeight?: number
}

/**
 * `resources` timeline — a horizontally virtualized stream of *days*, but each
 * rendered day is a `DayResourceGroup` of K worker sub-columns rather than a
 * single column. Architecturally this is `WeekView` (plan 13) with a nested
 * render unit: the virtualizer still counts days, the sizing/settle-snap/
 * scroll-anchor machinery is verbatim, only the per-day body and the column
 * math differ.
 *
 * Sizing is a hybrid clamp: aim for `desiredDays` visible, but never shrink a
 * worker sub-column below `MIN_COL_W` — big teams auto-drop to fewer days and
 * disengage per-day snapping (free pan within a day) when `dayWidth > avail`.
 *
 * `currentDate` is a scroll target taken literally; the view owns its visible
 * range and reports it via `onVisibleRangeChange`, scroll-settles emit the new
 * leftmost day via `onDateChange`.
 */
export function ResourceTimelineView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  resources,
  weekStartsOn: _weekStartsOn,
  backgroundEvents = NoBackgroundEvents,
  desiredDays = 1,
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
  selectedIds,
  onDateChange,
  onVisibleRangeChange,
  hourHeight = WeekCellsHeight,
}: ResourceTimelineViewProps<T>) {
  const selection = useCalendarSelection()
  const scrollRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [dayWidth, setDayWidth] = useState(480)
  const [gutterWidth, setGutterWidth] = useState(48)
  const [snapEnabled, setSnapEnabled] = useState(true)

  const K = resources.length

  const { start: windowStart, end: windowEnd } = useHourWindow()

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

  // Only depends on the hour-of-day, not any particular date — `epoch` is a stable
  // reference so this array's identity never changes, keeping it a scroll-stable
  // prop for the memoized DayResourceGroup below.
  const hours = useMemo(() => {
    return eachHourOfInterval({
      start: addHours(epoch, windowStart),
      end: addHours(epoch, windowEnd - 1),
    })
  }, [epoch, windowStart, windowEnd])

  const allDayByResource = useMemo(() => {
    const map = new Map<string, T[]>()
    for (const resource of resources) map.set(resource.id, [])
    for (const event of events) {
      if (!event.allDay && !isMultiDayEvent(event)) continue
      const list = event.resourceId ? map.get(event.resourceId) : undefined
      if (list) list.push(event)
    }
    return map
  }, [events, resources])

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event, e)
  }

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: dayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => dayWidth, [dayWidth]),
    overscan: 1,
  })

  // ── sizing (hybrid clamp): colWidth = max(MIN_COL_W, (avail/desiredDays)/K),
  // dayWidth = K × colWidth, snapEnabled when a full day fits. gutterWidth is
  // measured off the gutter wrapper (HourGutter's own w-12/sm:w-14). Synchronous
  // before first paint — the initial scroll depends on it. Re-measures whenever
  // the scroll el resizes, and (via deps) whenever desiredDays or K change.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const gutterEl = gutterRef.current
    if (!el || !gutterEl) return
    const applySize = () => {
      const gw = gutterEl.offsetWidth
      setGutterWidth(gw)
      const avail = Math.max(1, el.clientWidth - gw)
      const colWidth = Math.max(MIN_COL_W, avail / desiredDays / Math.max(1, K))
      const dw = Math.max(1, K) * colWidth
      setDayWidth(dw)
      setSnapEnabled(dw <= avail)
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(el)
    observer.observe(gutterEl)
    return () => observer.disconnect()
  }, [desiredDays, K])

  // Layout effect, declared BEFORE the scroll-to effect below: the virtualizer's
  // measurement cache must reflect the new day width before anything scrolls by it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when dayWidth OR K changes
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [dayWidth, K, virtualizer])

  // ── currentDate → scroll ─────────────────────────────────────────────────
  const targetIndex = dayIndexOf(currentDate)
  const programmaticScrollRef = useRef(false)
  const currentDateRef = useRef(currentDate)
  currentDateRef.current = currentDate
  // Set when a scroll-settle emits onDateChange — that date echoing back as the
  // `currentDate` prop must NOT re-scroll (the user is already looking at it).
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
  // Same JS settle-snap as week-view. This container scrolls BOTH axes — the
  // settle handler compares scrollLeft against its value from before this gesture
  // and skips when unchanged, so a pure vertical (time-axis) scroll never yanks
  // sideways. Snapping is GUARDED by snapEnabled: when a day is wider than the
  // viewport we skip the snap-scroll but still emit the (rounded) leftmost day.
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

  // ── visible window → consumer fetch range + current-time gating ─────────
  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index
  const lastIndex = virtualItems[virtualItems.length - 1]?.index

  useEffect(() => {
    if (firstIndex === undefined || lastIndex === undefined) return
    // End-inclusive `to` (endOfDay), matching the week/month stream convention.
    onVisibleRangeChange?.(dayAt(firstIndex), endOfDay(dayAt(lastIndex)))
  }, [firstIndex, lastIndex, dayAt, onVisibleRangeChange])

  // Current-time position/label math is date-independent (time-of-day only) — reused
  // from the shared hook via a mount-stable anchor so its internal 60s interval isn't
  // torn down/recreated on every scroll-driven re-render. Visibility is stream-specific:
  // true whenever today is anywhere in the rendered window (week pattern).
  const anchorNowRef = useRef(new Date())
  const { currentTimePosition, currentTimeLabel } = useCurrentTimeIndicator(
    anchorNowRef.current,
    'resource'
  )
  const showNowIndicator = useMemo(() => {
    if (firstIndex === undefined || lastIndex === undefined) return false
    for (let i = firstIndex; i <= lastIndex; i++) {
      if (isToday(dayAt(i))) return true
    }
    return false
  }, [firstIndex, lastIndex, dayAt])

  // All-day lane height is derived from the tallest stack in the rendered window,
  // across BOTH days and workers — it may shift while scrolling past unusually
  // stacked days (accepted v1, see plan 13).
  const maxAllDayStack = useMemo(() => {
    if (firstIndex === undefined || lastIndex === undefined) return 0
    let max = 0
    for (let i = firstIndex; i <= lastIndex; i++) {
      const day = dayAt(i)
      for (const resource of resources) {
        const count = getAllEventsForDay(allDayByResource.get(resource.id) ?? [], day).length
        if (count > max) max = count
      }
    }
    return max
  }, [firstIndex, lastIndex, dayAt, resources, allDayByResource])
  const laneHeight = Math.max(
    AllDayLaneMinHeight,
    maxAllDayStack * EventHeight + Math.max(0, maxAllDayStack - 1) * EventGap + AllDayLanePadding
  )
  const headerHeight = DateLabelHeight + WorkerHeaderHeight + laneHeight

  const gridColsStyle = { gridTemplateColumns: `repeat(${K}, minmax(0, 1fr))` }
  const totalSize = virtualizer.getTotalSize()

  return (
    <div data-slot='resource-timeline-view' className='flex min-h-0 flex-1 flex-col'>
      <div ref={scrollRef} onScroll={handleScroll} className='min-h-0 flex-1 overflow-auto'>
        <div
          className='relative'
          style={{
            width: gutterWidth + totalSize,
            minHeight: headerHeight + hours.length * hourHeight,
          }}>
          {/* Two-tier sticky header: date labels + worker sub-headers + always-visible all-day lane. */}
          <div
            className='bg-background/80 border-border/70 sticky top-0 z-30 border-b backdrop-blur-md'
            style={{ height: headerHeight }}>
            {/* Corner — sticky on both axes: pinned left within the (already sticky-top) strip. */}
            <div
              className='bg-background sticky left-0 z-10 flex flex-col'
              style={{ width: gutterWidth, height: headerHeight }}>
              <div
                className='text-muted-foreground/70 flex items-center justify-center text-sm'
                style={{ height: DateLabelHeight + WorkerHeaderHeight }}>
                <span className='max-[479px]:sr-only'>{format(new Date(), 'O')}</span>
              </div>
              <div className='bg-muted/50 relative' style={{ height: laneHeight }}>
                <span className='text-muted-foreground/70 absolute inset-0 flex items-center justify-end px-2 text-[10px] sm:px-3'>
                  All day
                </span>
              </div>
              <StickyRailShadow />
            </div>

            {/* Full-width hairline between the worker sub-headers and the all-day lane. */}
            <div
              className='bg-border/70 absolute inset-x-0 h-px'
              style={{ top: DateLabelHeight + WorkerHeaderHeight }}
            />

            {/* Row 1 — per-day date label, spanning the whole day-group width, centered. */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = gutterWidth + v.start
              const today = isToday(day)
              return (
                <div
                  key={`label-${v.key}`}
                  // Cmd/ctrl+click the day header grabs the whole day's events into the
                  // selection (§3.2), across every worker column.
                  onClick={(e) =>
                    selection.handleDayGrab(
                      getAllEventsForDay(events, day).map((ev) => ev.id),
                      e
                    )
                  }
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

            {/* Row 2 — the K worker sub-headers (the lifted resource-day-view header grid). */}
            {virtualItems.map((v) => {
              const x = gutterWidth + v.start
              return (
                <div
                  key={`workers-${v.key}`}
                  className='border-border/70 absolute grid border-l'
                  style={{
                    top: DateLabelHeight,
                    left: 0,
                    width: dayWidth,
                    height: WorkerHeaderHeight,
                    transform: `translateX(${x}px)`,
                    ...gridColsStyle,
                  }}>
                  {resources.map((resource) => (
                    <div
                      key={resource.id}
                      className='text-muted-foreground/70 border-border/70 flex items-center justify-center gap-1.5 border-l text-sm first:border-l-0'>
                      {resource.header ?? resource.label}
                    </div>
                  ))}
                </div>
              )
            })}

            {/* All-day lane — per worker per day, always present (slim min-height, no pop-in). */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = gutterWidth + v.start
              return (
                <div
                  key={`allday-${v.key}`}
                  className='bg-muted/50 border-border/70 absolute grid border-l'
                  style={{
                    top: DateLabelHeight + WorkerHeaderHeight,
                    left: 0,
                    width: dayWidth,
                    height: laneHeight,
                    transform: `translateX(${x}px)`,
                    ...gridColsStyle,
                  }}
                  data-today={isToday(day) || undefined}>
                  {resources.map((resource) => {
                    const laneEvents = getAllEventsForDay(
                      allDayByResource.get(resource.id) ?? [],
                      day
                    )
                    return (
                      <div
                        key={resource.id}
                        className='border-border/40 relative space-y-1 overflow-hidden border-l p-1 first:border-l-0'>
                        {laneEvents.map((event) => {
                          const eventStart = new Date(event.start)
                          const eventEnd = new Date(event.end)
                          const isFirstDay = isSameDay(day, eventStart)
                          const isLastDay = isSameDay(day, eventEnd)
                          return (
                            <EventItem
                              key={`spanning-${event.id}`}
                              onClick={(e) => handleEventClick(event, e)}
                              event={event}
                              view='resource'
                              allDayLane
                              isFirstDay={isFirstDay}
                              isLastDay={isLastDay}
                              isSelected={selectedIds?.has(event.id) ?? false}
                              renderEvent={renderEvent}>
                              <div
                                className={cn('truncate', !isFirstDay && 'invisible')}
                                aria-hidden={!isFirstDay}>
                                {event.title}
                              </div>
                            </EventItem>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Sticky hour gutter — pinned left only (no `top`: it scrolls vertically with the
              hour grid; its flow position already starts below the sticky header). */}
          <div ref={gutterRef} className='bg-background sticky left-0 z-20 w-fit'>
            <HourGutter
              hours={hours}
              nowIndicator={
                showNowIndicator
                  ? { position: currentTimePosition, label: currentTimeLabel }
                  : undefined
              }
            />
            <StickyRailShadow />
          </div>

          {virtualItems.map((v) => (
            <DayResourceGroup
              key={v.key}
              index={v.index}
              x={gutterWidth + v.start}
              dayWidth={dayWidth}
              top={headerHeight}
              dayAt={dayAt}
              resources={resources}
              hours={hours}
              events={events}
              backgroundEvents={backgroundEvents}
              onEventSelect={onEventSelect}
              onSlotClick={onSlotClick}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              selectedIds={selectedIds}
              currentTimePosition={currentTimePosition}
              hourHeight={hourHeight}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

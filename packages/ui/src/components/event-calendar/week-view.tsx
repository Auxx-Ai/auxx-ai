// packages/ui/src/components/event-calendar/week-view.tsx

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
  EndHour,
  EventGap,
  EventHeight,
  StartHour,
  StreamEndYear,
  StreamStartYear,
  WeekCellsHeight,
} from './constants'
import { EventItem } from './event-item'
import { useCurrentTimeIndicator } from './hooks/use-current-time-indicator'
import { HourGutter } from './hour-gutter'
import type { BackgroundEvent, EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, isMultiDayEvent } from './utils'
import { WeekDayColumn } from './week-day-column'

/** Height (px) of the sticky day-of-week / date label row. */
const HeaderLabelHeight = 36

/** Minimum height (px) of the always-visible all-day lane, even with zero events — no pop-in. */
const AllDayLaneMinHeight = 32

/** Vertical padding (px, top+bottom) inside the all-day lane, mirrors the old cell's `p-1`. */
const AllDayLanePadding = 8

/** Stable empty default — an inline `[]` would break `WeekDayColumn`'s memo every scroll frame. */
const NoBackgroundEvents: BackgroundEvent[] = []

interface WeekViewProps<T extends EventCalendarItem = EventCalendarItem> {
  /** Scroll target = the literal leftmost visible day (no `startOfWeek` normalization). */
  currentDate: Date
  events: T[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  backgroundEvents?: BackgroundEvent[]
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  onEventResize?: (event: T, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Fires when a user scroll settles on a new leftmost day. */
  onDateChange?: (date: Date) => void
  /** Fires with the rendered (visible + overscan) day window — consumers fetch this. */
  onVisibleRangeChange?: (from: Date, to: Date) => void
}

/**
 * Notion-Calendar-style week view: a single continuous, horizontally
 * virtualized stream of days — not a paged 7-day grid. Architecturally this
 * is `MonthView` rotated 90°: same `useVirtualizer` + synchronous-resize +
 * settle-snap machinery, just horizontal instead of vertical, plus a second
 * (vertical) scroll axis for the hour grid that the same container owns.
 *
 * `currentDate` is a scroll target taken literally — a "week" is just any 7
 * consecutive rendered days, resting on a mid-week anchor is normal. The view
 * owns its visible range and reports it upward via `onVisibleRangeChange`;
 * scroll-settles emit the new leftmost day via `onDateChange`.
 *
 * Every day column carries a hairline left border; the border strengthens at
 * each `weekStartsOn` boundary (Sun→Mon by default) — our addition, Notion
 * has no such distinction.
 */
export function WeekView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  weekStartsOn,
  backgroundEvents = NoBackgroundEvents,
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
  onDateChange,
  onVisibleRangeChange,
}: WeekViewProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [dayWidth, setDayWidth] = useState(160)
  const [gutterWidth, setGutterWidth] = useState(48)

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
  // reference so this array's identity never changes, which keeps it a scroll-stable
  // prop for the memoized WeekDayColumn below.
  const hours = useMemo(() => {
    return eachHourOfInterval({
      start: addHours(epoch, StartHour),
      end: addHours(epoch, EndHour - 1),
    })
  }, [epoch])

  const allDayEvents = useMemo(
    () => events.filter((event) => event.allDay || isMultiDayEvent(event)),
    [events]
  )

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: dayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => dayWidth, [dayWidth]),
    overscan: 5,
  })

  // ── sizing: dayWidth = (clientWidth − gutterWidth) / 7, gutterWidth measured off the
  // gutter wrapper itself (HourGutter's own responsive w-12/sm:w-14) — synchronously
  // before first paint, the initial scroll depends on it (month-view's `applyHeight`).
  useLayoutEffect(() => {
    const el = scrollRef.current
    const gutterEl = gutterRef.current
    if (!el || !gutterEl) return
    const applySize = () => {
      const gw = gutterEl.offsetWidth
      setGutterWidth(gw)
      setDayWidth(Math.max(1, (el.clientWidth - gw) / 7))
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(el)
    observer.observe(gutterEl)
    return () => observer.disconnect()
  }, [])

  // Layout effect, declared BEFORE the scroll-to effect below: the virtualizer's
  // measurement cache must reflect the new day width before anything scrolls by it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the day width changes
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [dayWidth, virtualizer])

  // ── currentDate → scroll ─────────────────────────────────────────────────
  const targetIndex = dayIndexOf(currentDate)
  const programmaticScrollRef = useRef(false)
  const currentDateRef = useRef(currentDate)
  currentDateRef.current = currentDate
  // Set when a scroll-settle emits onDateChange — that date echoing back as the
  // `currentDate` prop must NOT re-scroll (the user is already looking at it).
  const lastEmittedDateRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (lastEmittedDateRef.current === currentDateRef.current.getTime()) return
    const el = scrollRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTo({ left: targetIndex * dayWidth })
    const timeout = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 300)
    return () => clearTimeout(timeout)
  }, [targetIndex, dayWidth])

  // ── scroll → snap → currentDate ──────────────────────────────────────────
  // Same JS settle-snap as month-view (virtualization-safe, unlike CSS scroll-snap).
  // This container scrolls BOTH axes — the settle handler compares scrollLeft against
  // its value from before this scroll gesture and skips snapping when it's unchanged,
  // otherwise a pure vertical (time-axis) scroll would yank the view sideways.
  const lastScrollLeftRef = useRef(0)
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
      const snapOffset = snapIndex * dayWidth
      if (Math.abs(scrollLeft - snapOffset) > 2) {
        el.scrollTo({ left: snapOffset, behavior: 'smooth' })
        return // the smooth scroll re-settles here, aligned
      }
      const leftmost = dayAt(snapIndex)
      if (!isSameDay(leftmost, currentDateRef.current)) {
        lastEmittedDateRef.current = leftmost.getTime()
        onDateChange?.(leftmost)
      }
    }, 160)
  }, [dayCount, dayWidth, dayAt, onDateChange])

  useEffect(() => () => clearTimeout(settleTimeoutRef.current), [])

  // ── visible window → consumer fetch range + current-time gating ─────────
  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index
  const lastIndex = virtualItems[virtualItems.length - 1]?.index

  useEffect(() => {
    if (firstIndex === undefined || lastIndex === undefined) return
    // End-inclusive `to` (endOfDay), matching the month stream's endOfWeek convention.
    onVisibleRangeChange?.(dayAt(firstIndex), endOfDay(dayAt(lastIndex)))
  }, [firstIndex, lastIndex, dayAt, onVisibleRangeChange])

  // Current-time position/label math is date-independent (time-of-day only) — reused
  // from the shared hook via a mount-stable anchor so its internal 60s interval isn't
  // torn down/recreated on every scroll-driven re-render. Visibility, unlike day/resource
  // views, is stream-specific: true whenever today is anywhere in the rendered window.
  const anchorNowRef = useRef(new Date())
  const { currentTimePosition, currentTimeLabel } = useCurrentTimeIndicator(
    anchorNowRef.current,
    'day'
  )
  const showNowIndicator = useMemo(() => {
    if (firstIndex === undefined || lastIndex === undefined) return false
    for (let i = firstIndex; i <= lastIndex; i++) {
      if (isToday(dayAt(i))) return true
    }
    return false
  }, [firstIndex, lastIndex, dayAt])

  // All-day lane height is derived from the tallest stack in the rendered window — it
  // may shift while scrolling past unusually stacked days (accepted v1, see plan 13).
  const maxAllDayStack = useMemo(() => {
    if (firstIndex === undefined || lastIndex === undefined) return 0
    let max = 0
    for (let i = firstIndex; i <= lastIndex; i++) {
      const count = getAllEventsForDay(allDayEvents, dayAt(i)).length
      if (count > max) max = count
    }
    return max
  }, [firstIndex, lastIndex, dayAt, allDayEvents])
  const laneHeight = Math.max(
    AllDayLaneMinHeight,
    maxAllDayStack * EventHeight + Math.max(0, maxAllDayStack - 1) * EventGap + AllDayLanePadding
  )
  const headerHeight = HeaderLabelHeight + laneHeight

  const totalSize = virtualizer.getTotalSize()

  return (
    <div data-slot='week-view' className='flex min-h-0 flex-1 flex-col'>
      <div ref={scrollRef} onScroll={handleScroll} className='min-h-0 flex-1 overflow-auto'>
        <div
          className='relative'
          style={{
            width: gutterWidth + totalSize,
            minHeight: headerHeight + hours.length * WeekCellsHeight,
          }}>
          {/* Sticky header strip: day labels + always-visible all-day lane. */}
          <div
            className='bg-background/80 border-border/70 sticky top-0 z-30 border-b backdrop-blur-md'
            style={{ height: headerHeight }}>
            {/* Corner — sticky on both axes: pinned left within the (already sticky-top) strip. */}
            <div
              className='bg-background border-border/70 sticky left-0 z-10 flex flex-col border-r'
              style={{ width: gutterWidth, height: headerHeight }}>
              <div
                className='text-muted-foreground/70 flex items-center justify-center text-sm'
                style={{ height: HeaderLabelHeight }}>
                <span className='max-[479px]:sr-only'>{format(new Date(), 'O')}</span>
              </div>
              <div
                className='bg-muted/50 border-border/70 relative border-t'
                style={{ height: laneHeight }}>
                <span className='text-muted-foreground/70 absolute inset-x-0 bottom-1 px-2 text-right text-[10px] sm:px-4 sm:text-xs'>
                  All day
                </span>
              </div>
            </div>

            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = gutterWidth + v.start
              return (
                <div
                  key={`label-${v.key}`}
                  className='data-today:text-foreground text-muted-foreground/70 absolute flex items-center justify-center text-sm data-today:font-medium'
                  style={{
                    top: 0,
                    left: 0,
                    width: dayWidth,
                    height: HeaderLabelHeight,
                    transform: `translateX(${x}px)`,
                  }}
                  data-today={isToday(day) || undefined}>
                  <span className='sm:hidden' aria-hidden='true'>
                    {format(day, 'E')[0]} {format(day, 'd')}
                  </span>
                  <span className='max-sm:hidden'>{format(day, 'EEE dd')}</span>
                </div>
              )
            })}

            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const x = gutterWidth + v.start
              const isWeekBoundary = day.getDay() === weekStartsOn
              const dayAllDayEvents = getAllEventsForDay(allDayEvents, day)
              return (
                <div
                  key={`allday-${v.key}`}
                  className={cn(
                    'bg-muted/50 absolute space-y-1 overflow-hidden border-l border-border/40 p-1',
                    isWeekBoundary && 'border-l-2 border-border'
                  )}
                  style={{
                    top: HeaderLabelHeight,
                    left: 0,
                    width: dayWidth,
                    height: laneHeight,
                    transform: `translateX(${x}px)`,
                  }}
                  data-today={isToday(day) || undefined}>
                  {dayAllDayEvents.map((event) => {
                    const eventStart = new Date(event.start)
                    const eventEnd = new Date(event.end)
                    const isFirstDay = isSameDay(day, eventStart)
                    const isLastDay = isSameDay(day, eventEnd)
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

          {/* Sticky hour gutter — pinned left only (no `top`: it must scroll vertically with
              the hour grid; its flow position already starts below the sticky header). */}
          <div ref={gutterRef} className='bg-background sticky left-0 z-20 w-fit'>
            <HourGutter
              hours={hours}
              nowIndicator={
                showNowIndicator
                  ? { position: currentTimePosition, label: currentTimeLabel }
                  : undefined
              }
            />
          </div>

          {virtualItems.map((v) => (
            <WeekDayColumn
              key={v.key}
              index={v.index}
              x={gutterWidth + v.start}
              dayWidth={dayWidth}
              top={headerHeight}
              dayAt={dayAt}
              weekStartsOn={weekStartsOn}
              hours={hours}
              events={events}
              backgroundEvents={backgroundEvents}
              onEventSelect={onEventSelect}
              onSlotClick={onSlotClick}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              currentTimePosition={currentTimePosition}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

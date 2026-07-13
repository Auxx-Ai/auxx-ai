// packages/ui/src/components/event-calendar/month-view.tsx

'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarWeeks,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  DefaultStartHour,
  EventGap,
  EventHeight,
  StreamEndYear,
  StreamStartYear,
} from './constants'
import { DraggableEvent } from './draggable-event'
import { DroppableCell } from './droppable-cell'
import { EventItem } from './event-item'
import type { EventCalendarItem, RenderEvent } from './types'
import { getAllEventsForDay, getEventsForDay, getSpanningEventsForDay, sortEvents } from './utils'

/** Vertical px a day cell spends on its date label before event chips start. */
const CellHeaderHeight = 32

/** Minimum week-row height; below this the container just shows fewer rows per month. */
const MinRowHeight = 110

interface MonthWeekRowProps<T extends EventCalendarItem = EventCalendarItem> {
  index: number
  rowHeight: number
  /** Chip slots per cell; on overflow the last slot becomes "+N more". */
  slotCount: number
  events: T[]
  weekStartAt: (index: number) => Date
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  isNonWorkingDay?: (date: Date) => boolean
}

/**
 * One virtualized week row. Memoized — the virtualizer re-renders the whole
 * view on every scroll frame, and rows are by far the expensive part (7 cells
 * × event filtering × dnd droppables × chip popovers). Every prop here is
 * scroll-stable, so scrolling only mounts/unmounts rows at the window edges.
 */
function MonthWeekRowInner<T extends EventCalendarItem = EventCalendarItem>({
  index,
  rowHeight,
  slotCount,
  events,
  weekStartAt,
  onEventSelect,
  onSlotClick,
  renderEvent,
  selectedEventId,
  isNonWorkingDay,
}: MonthWeekRowProps<T>) {
  const weekStart = weekStartAt(index)

  const handleEventClick = (event: T, e: React.MouseEvent) => {
    e.stopPropagation()
    onEventSelect(event)
  }

  return (
    <div
      className='border-border/70 absolute left-0 grid w-full grid-cols-7 border-b'
      style={{ top: index * rowHeight, height: rowHeight }}>
      {Array.from({ length: 7 }).map((_, dayIndex) => {
        const day = addDays(weekStart, dayIndex)
        const isFirstOfMonth = day.getDate() === 1
        const dayEvents = getEventsForDay(events, day)
        const spanningEvents = getSpanningEventsForDay(events, day)
        const cellId = `month-cell-${day.toISOString()}`
        const allDayEvents = sortEvents([...spanningEvents, ...dayEvents])
        const allEvents = getAllEventsForDay(events, day)

        const hasMore = allDayEvents.length > slotCount
        const visibleCount = hasMore ? Math.max(0, slotCount - 1) : allDayEvents.length
        const remainingCount = allDayEvents.length - visibleCount

        return (
          <div
            key={day.toISOString()}
            className={cn(
              'group border-border/70 border-r last:border-r-0',
              // `muted`-based tints disappear on white — this stays visible in both themes.
              isNonWorkingDay?.(day) && 'bg-muted-foreground/8'
            )}
            data-today={isToday(day) || undefined}>
            <DroppableCell
              id={cellId}
              date={day}
              onClick={() => {
                const startTime = new Date(day)
                startTime.setHours(DefaultStartHour, 0, 0)
                onSlotClick?.(startTime)
              }}>
              <div className='mt-1 flex items-center gap-1'>
                {isFirstOfMonth && (
                  <span className='text-sm font-semibold'>{format(day, 'MMM')}</span>
                )}
                <div
                  className={cn(
                    'group-data-today:bg-primary group-data-today:text-primary-foreground inline-flex size-6 items-center justify-center rounded-full text-sm',
                    isFirstOfMonth && 'font-semibold'
                  )}>
                  {format(day, 'd')}
                </div>
              </div>
              <div>
                {allDayEvents.slice(0, visibleCount).map((event) => {
                  const eventStart = new Date(event.start)
                  const eventEnd = new Date(event.end)
                  const isFirstDay = isSameDay(day, eventStart)
                  const isLastDay = isSameDay(day, eventEnd)

                  if (!isFirstDay) {
                    // Spanning duplicate — keeps multi-day chips column-aligned
                    // (invisible title unless renderEvent overrides).
                    return (
                      <EventItem
                        key={`spanning-${event.id}-${day.toISOString().slice(0, 10)}`}
                        onClick={(e) => handleEventClick(event, e)}
                        event={event}
                        view='month'
                        isFirstDay={isFirstDay}
                        isLastDay={isLastDay}
                        isSelected={event.id === selectedEventId}
                        renderEvent={renderEvent}>
                        <div className='invisible' aria-hidden={true}>
                          {!event.allDay && <span>{format(new Date(event.start), 'h:mm')} </span>}
                          {event.title}
                        </div>
                      </EventItem>
                    )
                  }

                  return (
                    <DraggableEvent
                      key={event.id}
                      event={event}
                      view='month'
                      onClick={(e) => handleEventClick(event, e)}
                      isFirstDay={isFirstDay}
                      isLastDay={isLastDay}
                      isSelected={event.id === selectedEventId}
                      renderEvent={renderEvent}
                    />
                  )
                })}

                {hasMore && (
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <button
                        type='button'
                        className='focus-visible:border-ring focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 mt-[var(--event-gap)] flex h-[var(--event-height)] w-full items-center overflow-hidden px-1 text-left text-[10px] backdrop-blur-md transition outline-none select-none focus-visible:ring-[3px] sm:px-2 sm:text-xs'
                        onClick={(e) => e.stopPropagation()}>
                        <span>
                          + {remainingCount} <span className='max-sm:sr-only'>more</span>
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align='center'
                      className='max-w-52 p-3'
                      style={{ '--event-height': `${EventHeight}px` } as React.CSSProperties}>
                      <div className='space-y-2'>
                        <div className='text-sm font-medium'>{format(day, 'EEE d')}</div>
                        <div className='space-y-1'>
                          {sortEvents(allEvents).map((event) => (
                            <EventItem
                              key={event.id}
                              onClick={(e) => handleEventClick(event, e)}
                              event={event}
                              view='month'
                              isFirstDay={isSameDay(day, new Date(event.start))}
                              isLastDay={isSameDay(day, new Date(event.end))}
                              isSelected={event.id === selectedEventId}
                              renderEvent={renderEvent}
                            />
                          ))}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </DroppableCell>
          </div>
        )
      })}
    </div>
  )
}

// memo() drops the generic — the cast restores the generic call signature.
const MonthWeekRow = memo(MonthWeekRowInner) as typeof MonthWeekRowInner

interface MonthViewProps<T extends EventCalendarItem = EventCalendarItem> {
  currentDate: Date
  events: T[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  onEventSelect: (event: T) => void
  onSlotClick?: (startTime: Date) => void
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  /** Fires when a user scroll settles on a new month — with the stream's top-left day. */
  onDateChange?: (date: Date) => void
  /** Fires with the rendered (visible + overscan) week window — consumers fetch this. */
  onVisibleRangeChange?: (from: Date, to: Date) => void
  /** Cells where this returns true get a muted background (closed/non-working days). */
  isNonWorkingDay?: (date: Date) => boolean
}

/**
 * Apple-style month view: one continuous, virtualized stream of week rows
 * (months are labels inside the stream, not pages). Scrolling settles snapped
 * to the nearest week row — never a half-cut row. The view owns its visible
 * range and reports upward via `onVisibleRangeChange`; `currentDate` is a
 * scroll target — the stream scrolls when it changes from outside (toolbar
 * nav, date picker), while scroll-settles emit the top-left day back out.
 */
export function MonthView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  weekStartsOn,
  onEventSelect,
  onSlotClick,
  renderEvent,
  selectedEventId,
  onDateChange,
  onVisibleRangeChange,
  isNonWorkingDay,
}: MonthViewProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(140)

  const { epoch, weekCount } = useMemo(() => {
    const start = startOfWeek(new Date(StreamStartYear, 0, 1), { weekStartsOn })
    const count =
      differenceInCalendarWeeks(new Date(StreamEndYear, 0, 1), start, { weekStartsOn }) + 1
    return { epoch: start, weekCount: count }
  }, [weekStartsOn])

  const weekStartAt = useCallback((index: number) => addWeeks(epoch, index), [epoch])

  const weekIndexOf = useCallback(
    (date: Date) =>
      Math.min(
        weekCount - 1,
        Math.max(0, differenceInCalendarWeeks(date, epoch, { weekStartsOn }))
      ),
    [epoch, weekCount, weekStartsOn]
  )

  const weekdays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const date = addDays(startOfWeek(new Date(), { weekStartsOn }), i)
      return format(date, 'EEE')
    })
  }, [weekStartsOn])

  const virtualizer = useVirtualizer({
    count: weekCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 4,
  })

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const applyHeight = () => setRowHeight(Math.max(MinRowHeight, Math.floor(el.clientHeight / 6)))
    applyHeight() // synchronously before first paint — the initial scroll depends on it
    const observer = new ResizeObserver(applyHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Layout effect, and declared BEFORE the scroll-to effect below: the virtualizer's
  // measurement cache must reflect the new row height before anything scrolls by it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the row height changes
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  // ── currentDate → scroll ─────────────────────────────────────────────────
  // The month a date "views" is the month of its week's END — a month's first
  // row usually starts with trailing days of the previous month, and the
  // scroll-settle handler emits that row's top-left day as the new date.
  const targetIndex = weekIndexOf(startOfMonth(endOfWeek(currentDate, { weekStartsOn })))
  const programmaticScrollRef = useRef(false)
  const currentDateRef = useRef(currentDate)
  currentDateRef.current = currentDate
  // Set when a scroll-settle emits onDateChange — that date echoing back as the
  // `currentDate` prop must NOT re-scroll (the user is already looking at it).
  const lastEmittedDateRef = useRef<number | null>(null)

  // Rows are fixed-height, so the target offset is exact math — scrolling directly
  // (instead of virtualizer.scrollToIndex) sidesteps its measurement-cache staleness.
  useLayoutEffect(() => {
    if (lastEmittedDateRef.current === currentDateRef.current.getTime()) return
    const el = scrollRef.current
    if (!el) return
    programmaticScrollRef.current = true
    el.scrollTo({ top: targetIndex * rowHeight })
    const timeout = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 300)
    return () => clearTimeout(timeout)
  }, [targetIndex, rowHeight])

  // ── scroll → snap → currentDate ──────────────────────────────────────────
  // Snapping is JS-driven, not CSS scroll-snap: with virtualization only the
  // rendered rows would carry CSS snap points, and Chrome's mandatory snapping
  // walks the scroll position across the stream as the render window moves.
  // When a user scroll settles we smooth-scroll to the nearest week row (never
  // resting on a half-cut row); the smooth scroll re-enters this handler and,
  // once aligned, emits the settled row's top-left day as the new date.
  // The floating month labels are visible while scrolling and fade at rest.
  const [scrollLabelVisible, setScrollLabelVisible] = useState(false)
  const scrollLabelTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const handleScroll = useCallback(() => {
    if (!programmaticScrollRef.current) {
      setScrollLabelVisible(true)
      clearTimeout(scrollLabelTimeoutRef.current)
      scrollLabelTimeoutRef.current = setTimeout(() => setScrollLabelVisible(false), 700)
    }

    clearTimeout(settleTimeoutRef.current)
    settleTimeoutRef.current = setTimeout(() => {
      if (programmaticScrollRef.current) return
      const el = scrollRef.current
      if (!el) return
      const snapIndex = Math.min(weekCount - 1, Math.max(0, Math.round(el.scrollTop / rowHeight)))
      const snapOffset = snapIndex * rowHeight
      if (Math.abs(el.scrollTop - snapOffset) > 2) {
        el.scrollTo({ top: snapOffset, behavior: 'smooth' })
        return // the smooth scroll re-settles here, aligned
      }
      const topLeft = weekStartAt(snapIndex)
      if (!isSameDay(topLeft, currentDateRef.current)) {
        lastEmittedDateRef.current = topLeft.getTime()
        onDateChange?.(topLeft)
      }
    }, 160)
  }, [rowHeight, weekCount, weekStartAt, onDateChange])

  useEffect(
    () => () => {
      clearTimeout(settleTimeoutRef.current)
      clearTimeout(scrollLabelTimeoutRef.current)
    },
    []
  )

  // ── visible window → consumer fetch range ────────────────────────────────
  const virtualItems = virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index
  const lastIndex = virtualItems[virtualItems.length - 1]?.index

  useEffect(() => {
    if (firstIndex === undefined || lastIndex === undefined) return
    onVisibleRangeChange?.(
      weekStartAt(firstIndex),
      endOfWeek(weekStartAt(lastIndex), { weekStartsOn })
    )
  }, [firstIndex, lastIndex, weekStartAt, weekStartsOn, onVisibleRangeChange])

  // ── in-stream month labels ───────────────────────────────────────────────
  // Each visible month gets a full-height "track" positioned over its rows,
  // holding a `position: sticky` pill. The browser pins the pill to the
  // scrollport top while its month passes and pushes it out at the track's
  // end — native compositing, no per-frame JS positioning. Only depends on
  // the visible index RANGE, not the scroll offset.
  const monthLabelTracks = useMemo(() => {
    if (firstIndex === undefined || lastIndex === undefined) return []
    const tracks: { key: string; text: string; top: number; height: number }[] = []
    // The month whose track contains the first visible row.
    let month = startOfMonth(endOfWeek(weekStartAt(firstIndex), { weekStartsOn }))
    while (tracks.length < 6) {
      const startIndex = weekIndexOf(month)
      if (startIndex > lastIndex) break
      const nextIndex = weekIndexOf(addMonths(month, 1))
      tracks.push({
        key: format(month, 'yyyy-MM'),
        text: format(month, 'MMMM yyyy'),
        top: startIndex * rowHeight,
        height: (nextIndex - startIndex) * rowHeight,
      })
      month = addMonths(month, 1)
    }
    return tracks
  }, [firstIndex, lastIndex, rowHeight, weekStartAt, weekIndexOf, weekStartsOn])

  // Chip slots that fit a row; when a cell overflows, the last slot becomes "+N more".
  const slotCount = Math.max(
    0,
    Math.floor((rowHeight - CellHeaderHeight) / (EventHeight + EventGap))
  )

  return (
    <div data-slot='month-view' className='flex min-h-0 flex-1 flex-col'>
      <div className='border-border/70 grid grid-cols-7 border-b'>
        {weekdays.map((day) => (
          <div key={day} className='text-muted-foreground/70 py-2 text-center text-sm'>
            {day}
          </div>
        ))}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className='min-h-0 flex-1 overflow-y-auto'>
        <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
          {monthLabelTracks.map((track) => (
            <div
              key={track.key}
              aria-hidden
              className='pointer-events-none absolute left-0 z-10 w-fit'
              style={{ top: track.top, height: track.height }}>
              <div
                className={cn(
                  ' sticky top-2 ml-3 text-2xl  ',
                  // Appear instantly while scrolling; only the exit fades.
                  scrollLabelVisible ? 'opacity-100' : 'opacity-0 transition-opacity duration-500'
                )}>
                {track.text}
              </div>
            </div>
          ))}
          {virtualItems.map((row) => (
            <MonthWeekRow
              key={row.key}
              index={row.index}
              rowHeight={rowHeight}
              slotCount={slotCount}
              events={events}
              weekStartAt={weekStartAt}
              onEventSelect={onEventSelect}
              onSlotClick={onSlotClick}
              renderEvent={renderEvent}
              selectedEventId={selectedEventId}
              isNonWorkingDay={isNonWorkingDay}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

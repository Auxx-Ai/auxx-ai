// packages/ui/src/components/event-calendar/event-calendar.tsx

'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { CalendarCheck, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useMemo } from 'react'

import { AgendaView } from './agenda-view'
import { CalendarDndProvider, useCalendarDnd } from './calendar-dnd-context'
import {
  AgendaDaysToShow,
  EndHour,
  EventGap,
  EventHeight,
  GridAllDayChipHeight,
  GridAllDayChipSpacing,
  GridAllDayPaddingTop,
  GridHeaderHeight,
  GridTickHeight,
  GridTickMinutes,
  StartHour,
} from './constants'
import { DayView, DayViewHeader } from './day-view'
import { HorizontalTimelineView } from './horizontal-timeline-view'
import { MonthView } from './month-view'
import { ResourceTimelineView } from './resource-timeline-view'
import type {
  BackgroundEvent,
  CalendarResource,
  CalendarView,
  EventCalendarItem,
  RenderEvent,
  TimelineHourWindow,
} from './types'
import { WeekView } from './week-view'

/** Module-level default — an inline `{}` default would break `TimelineDaySection`'s memo every render. */
const DefaultHourWindow: TimelineHourWindow = { start: StartHour, end: EndHour }

export interface EventCalendarProps<T extends EventCalendarItem = EventCalendarItem> {
  events?: T[]
  /** Controlled — the calendar owns no date/view state of its own. */
  date: Date
  view: CalendarView
  onDateChange: (date: Date) => void
  onViewChange: (view: CalendarView) => void
  /** Fires whenever the visible range changes (view/date/weekStartsOn) — consumers fetch their own window. */
  onRangeChange?: (from: Date, to: Date) => void
  /** Default Monday (1) — pass 0 for Sunday-start weeks. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** Set (with `view='resource'`) to render the resource timeline (worker sub-columns per day). */
  resources?: CalendarResource[]
  /** Resource timeline only — how many days to aim for across the viewport (Day=1, Timeline=3). */
  resourceDaysVisible?: number
  /** Horizontal timeline (`view='timeline'`) only — visible hour range. Defaults to the full day. */
  hourWindow?: TimelineHourWindow
  backgroundEvents?: BackgroundEvent[]
  renderEvent?: RenderEvent<T>
  /** Id of the actively-selected event (its detail/popover open) — draws the in-color ring. */
  selectedEventId?: string | null
  onEventClick?: (event: T) => void
  onSlotClick?: (startTime: Date, resourceId?: string) => void
  /** The calendar never mutates — every write (move or resize) round-trips through these. */
  onEventDrop?: (event: T, newStart: Date, newEnd: Date, resourceId?: string) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  /** Hide the built-in date-nav/view-switcher header when the consumer brings their own toolbar chrome. */
  hideToolbar?: boolean
  /** Month view only — cells where this returns true get a muted background (closed days). */
  isNonWorkingDay?: (date: Date) => boolean
  className?: string
}

const VIEW_OPTIONS: { value: CalendarView; label: string; shortcut: string }[] = [
  { value: 'month', label: 'Month', shortcut: 'M' },
  { value: 'week', label: 'Week', shortcut: 'W' },
  { value: 'day', label: 'Day', shortcut: 'D' },
  { value: 'agenda', label: 'Agenda', shortcut: 'A' },
]

function EventCalendarInner<T extends EventCalendarItem = EventCalendarItem>({
  events = [],
  date,
  view,
  onDateChange,
  onViewChange,
  onRangeChange,
  weekStartsOn = 1,
  resources,
  resourceDaysVisible = 1,
  hourWindow = DefaultHourWindow,
  backgroundEvents,
  renderEvent,
  selectedEventId,
  onEventClick,
  onSlotClick,
  onEventDrop,
  onEventResize,
  hideToolbar,
  isNonWorkingDay,
  className,
}: EventCalendarProps<T>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      const match = VIEW_OPTIONS.find((o) => o.shortcut.toLowerCase() === e.key.toLowerCase())
      if (match) onViewChange(match.value)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onViewChange])

  // Month view is a continuous week stream (see MonthView): the "viewed month" is the month
  // of the anchor date's week END, and month nav lands on the target month's top-left cell.
  const viewedMonthStart = startOfMonth(endOfWeek(date, { weekStartsOn }))

  const handlePrevious = () => {
    if (view === 'month')
      onDateChange(startOfWeek(subMonths(viewedMonthStart, 1), { weekStartsOn }))
    else if (view === 'week') onDateChange(subWeeks(date, 1))
    else if (view === 'day' || view === 'resource' || view === 'timeline')
      onDateChange(addDays(date, -1))
    else if (view === 'agenda') onDateChange(addDays(date, -AgendaDaysToShow))
  }

  const handleNext = () => {
    if (view === 'month')
      onDateChange(startOfWeek(addMonths(viewedMonthStart, 1), { weekStartsOn }))
    else if (view === 'week') onDateChange(addWeeks(date, 1))
    else if (view === 'day' || view === 'resource' || view === 'timeline')
      onDateChange(addDays(date, 1))
    else if (view === 'agenda') onDateChange(addDays(date, AgendaDaysToShow))
  }

  const handleToday = () => {
    if (view === 'week') onDateChange(startOfWeek(new Date(), { weekStartsOn }))
    else onDateChange(new Date())
  }

  const handleEventSelect = (event: T) => onEventClick?.(event)

  const handleSlotClick = (startTime: Date, resourceId?: string) => {
    const minutes = startTime.getMinutes()
    const remainder = minutes % 15
    if (remainder !== 0) {
      startTime.setMinutes(remainder < 7.5 ? minutes - remainder : minutes + (15 - remainder))
      startTime.setSeconds(0, 0)
    }
    onSlotClick?.(startTime, resourceId)
  }

  const [rangeFrom, rangeTo] = useMemo<[Date, Date]>(() => {
    if (view === 'month') {
      // Placeholder — the month stream reports its own visible range (skipped below).
      const monthStart = startOfMonth(endOfWeek(date, { weekStartsOn }))
      return [
        startOfWeek(monthStart, { weekStartsOn }),
        endOfWeek(endOfMonth(monthStart), { weekStartsOn }),
      ]
    }
    if (view === 'week') {
      // Placeholder — the week stream reports its own visible range (skipped below).
      return [date, addDays(date, 6)]
    }
    if (view === 'day' || view === 'resource' || view === 'timeline') {
      return [startOfDay(date), endOfDay(date)]
    }
    // agenda
    return [startOfDay(date), endOfDay(addDays(date, AgendaDaysToShow - 1))]
  }, [date, view, weekStartsOn])

  useEffect(() => {
    // The month/week/resource/timeline streams drive their own range via onVisibleRangeChange.
    if (view === 'month' || view === 'week' || view === 'resource' || view === 'timeline') return
    onRangeChange?.(rangeFrom, rangeTo)
  }, [view, rangeFrom, rangeTo, onRangeChange])

  const viewTitle: ReactNode = useMemo(() => {
    if (view === 'month') {
      return format(startOfMonth(endOfWeek(date, { weekStartsOn })), 'MMMM yyyy')
    }
    if (view === 'week') {
      const start = date
      const end = addDays(date, 6)
      return isSameMonth(start, end)
        ? format(start, 'MMMM yyyy')
        : `${format(start, 'MMM')} - ${format(end, 'MMM yyyy')}`
    }
    if (view === 'day' || view === 'resource' || view === 'timeline') {
      return <DayViewHeader currentDate={date} />
    }
    if (view === 'agenda') {
      const start = date
      const end = addDays(date, AgendaDaysToShow - 1)
      return isSameMonth(start, end)
        ? format(start, 'MMMM yyyy')
        : `${format(start, 'MMM')} - ${format(end, 'MMM yyyy')}`
    }
    return format(date, 'MMMM yyyy')
  }, [date, view, weekStartsOn])

  const dndContext = useCalendarDnd()
  const withinAmbientProvider = dndContext.isCalendarDndContext

  const body = (
    <>
      {!hideToolbar && (
        <div className='flex items-center justify-between p-2 sm:p-4'>
          <div className='flex items-center gap-1 sm:gap-4'>
            <button
              type='button'
              className='hover:bg-accent inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-sm max-[479px]:aspect-square max-[479px]:p-0'
              onClick={handleToday}>
              <CalendarCheck className='min-[480px]:hidden' size={16} aria-hidden='true' />
              <span className='max-[479px]:sr-only'>Today</span>
            </button>
            <div className='flex items-center sm:gap-2'>
              <button
                type='button'
                className='hover:bg-accent inline-flex size-8 items-center justify-center rounded-md'
                onClick={handlePrevious}
                aria-label='Previous'>
                <ChevronLeftIcon size={16} aria-hidden='true' />
              </button>
              <button
                type='button'
                className='hover:bg-accent inline-flex size-8 items-center justify-center rounded-md'
                onClick={handleNext}
                aria-label='Next'>
                <ChevronRightIcon size={16} aria-hidden='true' />
              </button>
            </div>
            <div className='text-sm font-semibold sm:text-lg md:text-xl'>{viewTitle}</div>
          </div>
          <div className='flex items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm'>
                  <span>
                    <span className='min-[480px]:hidden' aria-hidden='true'>
                      {(view === 'resource' ? 'day' : view).charAt(0).toUpperCase()}
                    </span>
                    <span className='max-[479px]:sr-only'>
                      {view === 'resource' ? 'Day' : view.charAt(0).toUpperCase() + view.slice(1)}
                    </span>
                  </span>
                  <ChevronDownIcon className='-me-1 opacity-60' size={16} aria-hidden='true' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='min-w-32'>
                {VIEW_OPTIONS.map((option) => (
                  <DropdownMenuItem key={option.value} onClick={() => onViewChange(option.value)}>
                    {option.label}
                    <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          // The month/week/resource/timeline streams own their own (snap) scroll containers.
          view === 'month' || view === 'week' || view === 'resource' || view === 'timeline'
            ? 'overflow-hidden'
            : 'overflow-y-auto'
        )}>
        {view === 'month' && (
          <MonthView
            currentDate={date}
            events={events}
            weekStartsOn={weekStartsOn}
            onEventSelect={handleEventSelect}
            onSlotClick={handleSlotClick}
            renderEvent={renderEvent}
            selectedEventId={selectedEventId}
            onDateChange={onDateChange}
            onVisibleRangeChange={onRangeChange}
            isNonWorkingDay={isNonWorkingDay}
          />
        )}
        {view === 'week' && (
          <WeekView
            currentDate={date}
            events={events}
            weekStartsOn={weekStartsOn}
            backgroundEvents={backgroundEvents}
            onEventSelect={handleEventSelect}
            onSlotClick={handleSlotClick}
            onEventResize={onEventResize}
            renderEvent={renderEvent}
            selectedEventId={selectedEventId}
            onDateChange={onDateChange}
            onVisibleRangeChange={onRangeChange}
          />
        )}
        {view === 'day' && (
          <DayView
            currentDate={date}
            events={events}
            backgroundEvents={backgroundEvents}
            onEventSelect={handleEventSelect}
            onSlotClick={handleSlotClick}
            onEventResize={onEventResize}
            renderEvent={renderEvent}
            selectedEventId={selectedEventId}
          />
        )}
        {view === 'resource' &&
          (resources ? (
            <ResourceTimelineView
              currentDate={date}
              events={events}
              resources={resources}
              weekStartsOn={weekStartsOn}
              desiredDays={resourceDaysVisible}
              backgroundEvents={backgroundEvents}
              onEventSelect={handleEventSelect}
              onSlotClick={handleSlotClick}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              selectedEventId={selectedEventId}
              onDateChange={onDateChange}
              onVisibleRangeChange={onRangeChange}
            />
          ) : null)}
        {view === 'timeline' &&
          (resources ? (
            <HorizontalTimelineView
              currentDate={date}
              events={events}
              resources={resources}
              weekStartsOn={weekStartsOn}
              backgroundEvents={backgroundEvents}
              hourWindow={hourWindow}
              onEventSelect={handleEventSelect}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              selectedEventId={selectedEventId}
              onDateChange={onDateChange}
              onVisibleRangeChange={onRangeChange}
            />
          ) : null)}
        {view === 'agenda' && (
          <AgendaView
            currentDate={date}
            events={events}
            onEventSelect={handleEventSelect}
            renderEvent={renderEvent}
            selectedEventId={selectedEventId}
          />
        )}
      </div>
    </>
  )

  return (
    <div
      className={cn('flex min-w-0 flex-col', className)}
      style={
        {
          '--event-height': `${EventHeight}px`,
          '--event-gap': `${EventGap}px`,
          // Notion-style tick grid: the hour-row height derives from the 5-minute
          // tick, so every timed cell/position scales off one knob.
          '--grid-tick-height': `${GridTickHeight}px`,
          '--grid-tick-minutes': `${GridTickMinutes}`,
          '--week-cells-height': `calc(var(--grid-tick-height) * 60 / var(--grid-tick-minutes))`,
          '--grid-header-height': `${GridHeaderHeight}px`,
          '--grid-all-day-chip-height': `${GridAllDayChipHeight}px`,
          '--grid-all-day-chip-spacing': `${GridAllDayChipSpacing}px`,
          '--grid-all-day-padding-top': `${GridAllDayPaddingTop}px`,
        } as CSSProperties
      }>
      {withinAmbientProvider ? (
        body
      ) : (
        <CalendarDndProvider onEventDrop={onEventDrop} renderEvent={renderEvent}>
          {body}
        </CalendarDndProvider>
      )}
    </div>
  )
}

/**
 * The `event-calendar` primitive — vendored from origin-space/event-calendar
 * (MIT), slimmed and reworked for `@auxx/ui`. Never mutates: every write
 * (move, resize, click) round-trips through the callback props.
 *
 * Mounts its own `CalendarDndProvider` unless it detects it's already inside
 * one (see `CalendarDndProvider`'s doc comment for composing an external
 * provider — e.g. to share drag context with a backlog rail).
 */
export function EventCalendar<T extends EventCalendarItem = EventCalendarItem>(
  props: EventCalendarProps<T>
) {
  return <EventCalendarInner {...props} />
}

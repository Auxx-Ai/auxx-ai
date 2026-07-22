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
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

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
  GridTickMinutes,
  StartHour,
  WeekCellsHeight,
  WeekCellsHeightMax,
  WeekCellsHeightMin,
} from './constants'
import { DayView, DayViewHeader } from './day-view'
import { HorizontalTimelineView } from './horizontal-timeline-view'
import { HourWindowProvider } from './hour-window-context'
import { MonthView } from './month-view'
import { ResourceTimelineView } from './resource-timeline-view'
import {
  CalendarSelectionProvider,
  type HoveredSlot,
  useCalendarSelectionEngine,
} from './selection/calendar-selection-context'
import { MarqueeOverlay } from './selection/marquee-overlay'
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

/** Module-level default — an inline `[]` default would recompute `selectedIdSet` (and the
 * selection engine's live snapshot) every render for consumers that don't control selection. */
const EmptySelectedEventIds: string[] = []

const clampHourHeight = (px: number) =>
  Math.min(WeekCellsHeightMax, Math.max(WeekCellsHeightMin, px))

/** Multiplicative zoom gain per wheel `deltaY` unit (ctrl+wheel / trackpad pinch). */
const WheelZoomGain = 0.01

/** Idle time (ms) after the last ctrl+wheel event before the vertical-grid zoom commits. */
const WheelZoomCommitDelay = 160

/**
 * Nearest ancestor (up to and including `root`) whose computed overflow-y scrolls — the vertical
 * grids' scroll container differs per view (day scrolls the shell's own container; week/resource
 * own an inner two-axis scroller).
 */
function findScrollContainer(from: HTMLElement | null, root: HTMLElement): HTMLElement {
  let el: HTMLElement | null = from
  while (el && el !== root) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
    el = el.parentElement
  }
  return root
}

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
  /** Timeline zoom (plan 35): controlled px-per-hour. Omit for the view's internal state. */
  timelineHourWidth?: number
  /** Fires when a timeline zoom gesture (border drag / ctrl+wheel) commits a new px-per-hour. */
  onTimelineHourWidthChange?: (px: number) => void
  /** Timeline worker-rail width (plan 35): controlled px. Omit for the view's internal state. */
  timelineRailWidth?: number
  /** Fires when the timeline rail-width drag commits a new width. */
  onTimelineRailWidthChange?: (px: number) => void
  /** Vertical-grid zoom: controlled px-per-hour for week/day/resource views. Omit for internal state. */
  gridHourHeight?: number
  /** Fires when a vertical-grid zoom gesture (ctrl+wheel / pinch) commits a new px-per-hour. */
  onGridHourHeightChange?: (px: number) => void
  backgroundEvents?: BackgroundEvent[]
  renderEvent?: RenderEvent<T>
  /** Controlled multi-selection (plan `37c-calendar-create-copy-paste.md` §3) — the grid
   * interprets every selection gesture (plain/cmd/shift-click, marquee, day-grab, Escape) and
   * reports the result here; the consumer owns the actual state. Selected chips draw the
   * in-color ring. */
  selectedEventIds?: string[]
  /** Fires whenever a selection gesture changes the set — always the full replacement set. */
  onSelectionChange?: (ids: string[]) => void
  /** Fires on a PLAIN chip click only (no modifier) — cmd/ctrl/shift-clicks manage selection
   * instead and never call this, so a popover/drawer wired here never opens on a modifier-click.
   * Carries the mouse event so a consumer can read further modifiers if it needs to. */
  onEventClick?: (event: T, e: React.MouseEvent) => void
  onSlotClick?: (startTime: Date, resourceId?: string) => void
  /** Plan 37c §4 — when provided, every hovered-slot report (pointer-enter on a day/time cell)
   * also lands here, mirroring the selection engine's own internal ref. Lets a consumer read
   * "what's hovered right now" for a Cmd+V paste anchor or a right-click menu without owning a
   * selection engine of its own. Ref-only, never causes a re-render. */
  hoveredSlotRef?: React.MutableRefObject<HoveredSlot | null>
  /**
   * The calendar never mutates — every write (move or resize) round-trips through these.
   * `groupIds` (plan 37c §6) — see `CalendarDndProvider`'s `onEventDrop` doc.
   */
  onEventDrop?: (
    event: T,
    newStart: Date,
    newEnd: Date,
    resourceId?: string,
    groupIds?: string[]
  ) => void
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
  timelineHourWidth,
  onTimelineHourWidthChange,
  timelineRailWidth,
  onTimelineRailWidthChange,
  gridHourHeight,
  onGridHourHeightChange,
  backgroundEvents,
  renderEvent,
  selectedEventIds = EmptySelectedEventIds,
  onSelectionChange,
  onEventClick,
  onSlotClick,
  onEventDrop,
  onEventResize,
  hideToolbar,
  isNonWorkingDay,
  className,
  hoveredSlotRef,
}: EventCalendarProps<T>) {
  // Memoized once here (not per-view) — every view flips its `isSelected` check from id-equality
  // to `selectedIds.has(event.id)` against this single Set.
  const selectedIdSet = useMemo(() => new Set(selectedEventIds), [selectedEventIds])
  // Built once (see `useCalendarSelectionEngine`'s doc comment) so both this component's own
  // gesture handlers below AND the provider it renders further down share the same instance.
  const selectionEngine = useCalendarSelectionEngine(
    events,
    selectedIdSet,
    onSelectionChange,
    hoveredSlotRef
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'Escape' && selectedIdSet.size > 0) {
        selectionEngine.clearSelection()
        return
      }

      const match = VIEW_OPTIONS.find((o) => o.shortcut.toLowerCase() === e.key.toLowerCase())
      if (match) onViewChange(match.value)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onViewChange, selectedIdSet, selectionEngine])

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

  // Central gesture interpretation (§3.2) — every view's chip `onClick` funnels here through
  // `onEventSelect`, passing its raw mouse event through instead of branching modifiers itself.
  // `onEventClick` (the popover/drawer hook) only fires for a genuinely plain click.
  const handleEventSelect = (event: T, e: React.MouseEvent) => {
    const isPlainClick = selectionEngine.handleChipClick(event.id, e)
    if (isPlainClick) onEventClick?.(event, e)
  }

  const handleSlotClick = (startTime: Date, resourceId?: string) => {
    // "Click away to deselect": a non-empty selection swallows this click entirely — it must
    // never also open a slot-create affordance. An empty selection falls through unchanged.
    selectionEngine.handleEmptyClick(() => {
      const minutes = startTime.getMinutes()
      const remainder = minutes % 15
      if (remainder !== 0) {
        startTime.setMinutes(remainder < 7.5 ? minutes - remainder : minutes + (15 - remainder))
        startTime.setSeconds(0, 0)
      }
      onSlotClick?.(startTime, resourceId)
    })
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
      // Day-grab (§3.2) only wires here for the plain 'day' view — resource/timeline render
      // their own per-day date labels in-stream (possibly several visible at once) and grab
      // from those instead, so this shared title stays a non-interactive header for them.
      return <DayViewHeader currentDate={date} events={view === 'day' ? events : undefined} />
    }
    if (view === 'agenda') {
      const start = date
      const end = addDays(date, AgendaDaysToShow - 1)
      return isSameMonth(start, end)
        ? format(start, 'MMMM yyyy')
        : `${format(start, 'MMM')} - ${format(end, 'MMM yyyy')}`
    }
    return format(date, 'MMMM yyyy')
  }, [date, view, weekStartsOn, events])

  const dndContext = useCalendarDnd()
  const withinAmbientProvider = dndContext.isCalendarDndContext

  // ── vertical-grid zoom (week/day/resource) ────────────────────────────────
  // Same controlled-or-internal shape as the timeline's hourWidth, but a far simpler gesture:
  // there is no virtualized stream on the y-axis, so keeping the time under the cursor
  // stationary is just a scrollTop adjustment — no CSS-var compensation machinery. Live wheel
  // frames render through React state; the (rounded) commit debounces behind the last event.
  const viewContainerRef = useRef<HTMLDivElement>(null)
  const [internalGridHourHeight, setInternalGridHourHeight] = useState(WeekCellsHeight)
  const committedGridHourHeight = clampHourHeight(gridHourHeight ?? internalGridHourHeight)
  const [liveGridHourHeight, setLiveGridHourHeight] = useState<number | null>(null)
  const effectiveGridHourHeight = liveGridHourHeight ?? committedGridHourHeight

  const gridZoomRef = useRef<{
    scroller: HTMLElement
    /** Grid-origin Y in the scroller's content space — zoom-invariant (header chrome is fixed). */
    gridTop: number
    /** Live fractional px-per-hour — the JS-space source the DOM follows. */
    hourHeight: number
    /** Virtual scrollTop paired with `hourHeight` — applied to the DOM after each render. */
    scrollTop: number
  } | null>(null)
  const gridZoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingGridScrollRef = useRef<{ scroller: HTMLElement; top: number } | null>(null)
  const gridZoomGeoRef = useRef({ view, committedGridHourHeight, onGridHourHeightChange })
  gridZoomGeoRef.current = { view, committedGridHourHeight, onGridHourHeightChange }

  // The wheel handler mutates the gesture's virtual scrollTop in JS-space; the DOM catches up
  // here, after React has re-rendered the grid at the new height. No dependency array —
  // deliberately runs every render while a gesture (or a commit's scroll) is pending.
  useLayoutEffect(() => {
    const gesture = gridZoomRef.current
    if (gesture) gesture.scroller.scrollTop = gesture.scrollTop
    const pending = pendingGridScrollRef.current
    if (pending) {
      pendingGridScrollRef.current = null
      pending.scroller.scrollTop = pending.top
    }
  })

  useEffect(() => {
    const root = viewContainerRef.current
    if (!root) return

    const isVerticalGridView = () => {
      const { view: currentView } = gridZoomGeoRef.current
      return currentView === 'week' || currentView === 'day' || currentView === 'resource'
    }

    /** Scroller + zoom-invariant grid-origin Y for the view under `target`. */
    const resolveGeometry = (target: HTMLElement) => {
      const scroller = findScrollContainer(target, root)
      const gutter = scroller.querySelector('[data-slot="hour-gutter"]')
      if (!gutter) return null
      const gridTop =
        gutter.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      return { scroller, gridTop }
    }

    /** Ends the active gesture: commits the rounded height + the re-anchored scrollTop. */
    const commitGridZoom = () => {
      const g = gridZoomRef.current
      if (!g) return
      gridZoomRef.current = null
      const finalHeight = clampHourHeight(Math.round(g.hourHeight))
      // Re-anchor at the scroller's top edge for the (≤0.5px/hour) rounding delta.
      const topHours = (g.scrollTop - g.gridTop) / g.hourHeight
      pendingGridScrollRef.current = {
        scroller: g.scroller,
        top: Math.max(0, g.scrollTop + topHours * (finalHeight - g.hourHeight)),
      }
      const commit = gridZoomGeoRef.current.onGridHourHeightChange
      if (commit) commit(finalHeight)
      else setInternalGridHourHeight(finalHeight)
      setLiveGridHourHeight(null)
    }

    // Non-passive so `preventDefault` can stop the browser's page zoom.
    const onWheel = (e: WheelEvent) => {
      const { committedGridHourHeight: committed } = gridZoomGeoRef.current
      if (!e.ctrlKey || !isVerticalGridView()) return
      e.preventDefault()

      let gesture = gridZoomRef.current
      if (!gesture) {
        const geo = resolveGeometry(e.target as HTMLElement)
        if (!geo) return
        gesture = { ...geo, hourHeight: committed, scrollTop: geo.scroller.scrollTop }
        gridZoomRef.current = gesture
      }

      const oldHeight = gesture.hourHeight
      const newHeight = clampHourHeight(oldHeight * Math.exp(-e.deltaY * WheelZoomGain))
      // Anchor: the time under the cursor stays put — scrollTop absorbs the anchor's growth.
      const cursorOffset = e.clientY - gesture.scroller.getBoundingClientRect().top
      const anchorHours = (gesture.scrollTop + cursorOffset - gesture.gridTop) / oldHeight
      gesture.hourHeight = newHeight
      gesture.scrollTop = Math.max(0, gesture.scrollTop + anchorHours * (newHeight - oldHeight))
      setLiveGridHourHeight(newHeight)

      clearTimeout(gridZoomCommitTimerRef.current)
      gridZoomCommitTimerRef.current = setTimeout(commitGridZoom, WheelZoomCommitDelay)
    }

    // Border drag on the gutter's `data-hour-zoom-handle` strips (parity with the timeline's
    // draggable hour borders): the grabbed hour rule tracks the pointer — height' = start + dy —
    // while the hour above it stays anchored via the same virtual-scrollTop plumbing.
    const onPointerDown = (e: PointerEvent) => {
      const { committedGridHourHeight: committed } = gridZoomGeoRef.current
      if (e.button !== 0 || !isVerticalGridView() || gridZoomRef.current) return
      const handle = (e.target as HTMLElement | null)?.closest?.('[data-hour-zoom-handle]')
      if (!(handle instanceof HTMLElement)) return
      const borderIndex = Number(handle.dataset.hourZoomHandle)
      if (!Number.isFinite(borderIndex)) return
      const geo = resolveGeometry(handle)
      if (!geo) return
      e.preventDefault()

      gridZoomRef.current = { ...geo, hourHeight: committed, scrollTop: geo.scroller.scrollTop }
      const startClientY = e.clientY
      // Anchor the grabbed hour's TOP edge, so the dragged border sits exactly one (new)
      // hour-height below it and tracks the pointer.
      const anchorHours = borderIndex - 1

      const onMove = (me: PointerEvent) => {
        const g = gridZoomRef.current
        if (!g) return
        const newHeight = clampHourHeight(committed + (me.clientY - startClientY))
        if (newHeight === g.hourHeight) return
        g.scrollTop = Math.max(0, g.scrollTop + anchorHours * (newHeight - g.hourHeight))
        g.hourHeight = newHeight
        setLiveGridHourHeight(newHeight)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        commitGridZoom()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    /** Double-click a gutter handle → reset to the default scale, keeping that border put. */
    const onDoubleClick = (e: MouseEvent) => {
      const { committedGridHourHeight: committed } = gridZoomGeoRef.current
      if (!isVerticalGridView() || committed === WeekCellsHeight || gridZoomRef.current) return
      const handle = (e.target as HTMLElement | null)?.closest?.('[data-hour-zoom-handle]')
      if (!(handle instanceof HTMLElement)) return
      const geo = resolveGeometry(handle)
      if (!geo) return
      const anchorHours = Number(handle.dataset.hourZoomHandle) - 1
      pendingGridScrollRef.current = {
        scroller: geo.scroller,
        top: Math.max(0, geo.scroller.scrollTop + anchorHours * (WeekCellsHeight - committed)),
      }
      const commit = gridZoomGeoRef.current.onGridHourHeightChange
      if (commit) commit(WeekCellsHeight)
      else setInternalGridHourHeight(WeekCellsHeight)
    }

    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('dblclick', onDoubleClick)
    return () => {
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('dblclick', onDoubleClick)
      clearTimeout(gridZoomCommitTimerRef.current)
    }
  }, [])

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
        ref={viewContainerRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          // The month/week/resource/timeline streams own their own (snap) scroll containers.
          view === 'month' || view === 'week' || view === 'resource' || view === 'timeline'
            ? 'overflow-hidden'
            : 'overflow-y-auto'
        )}>
        <HourWindowProvider value={hourWindow}>
          {view === 'month' && (
            <MonthView
              currentDate={date}
              events={events}
              weekStartsOn={weekStartsOn}
              onEventSelect={handleEventSelect}
              onSlotClick={handleSlotClick}
              renderEvent={renderEvent}
              selectedIds={selectedIdSet}
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
              selectedIds={selectedIdSet}
              onDateChange={onDateChange}
              onVisibleRangeChange={onRangeChange}
              hourHeight={effectiveGridHourHeight}
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
              selectedIds={selectedIdSet}
              hourHeight={effectiveGridHourHeight}
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
                selectedIds={selectedIdSet}
                onDateChange={onDateChange}
                onVisibleRangeChange={onRangeChange}
                hourHeight={effectiveGridHourHeight}
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
                hourWidth={timelineHourWidth}
                onHourWidthChange={onTimelineHourWidthChange}
                railWidth={timelineRailWidth}
                onRailWidthChange={onTimelineRailWidthChange}
                onEventSelect={handleEventSelect}
                onSlotClick={handleSlotClick}
                onEventResize={onEventResize}
                renderEvent={renderEvent}
                selectedIds={selectedIdSet}
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
              selectedIds={selectedIdSet}
            />
          )}
        </HourWindowProvider>
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
          // tick, so every timed cell/position scales off one knob — here fed by
          // the (zoomable) grid hour height instead of the static constant.
          '--grid-tick-height': `${(effectiveGridHourHeight * GridTickMinutes) / 60}px`,
          '--grid-tick-minutes': `${GridTickMinutes}`,
          '--week-cells-height': `calc(var(--grid-tick-height) * 60 / var(--grid-tick-minutes))`,
          '--grid-header-height': `${GridHeaderHeight}px`,
          '--grid-all-day-chip-height': `${GridAllDayChipHeight}px`,
          '--grid-all-day-chip-spacing': `${GridAllDayChipSpacing}px`,
          '--grid-all-day-padding-top': `${GridAllDayPaddingTop}px`,
        } as CSSProperties
      }>
      <CalendarSelectionProvider engine={selectionEngine}>
        {withinAmbientProvider ? (
          body
        ) : (
          <CalendarDndProvider onEventDrop={onEventDrop} renderEvent={renderEvent}>
            {body}
          </CalendarDndProvider>
        )}
        <MarqueeOverlay containerRef={viewContainerRef} engine={selectionEngine} />
      </CalendarSelectionProvider>
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

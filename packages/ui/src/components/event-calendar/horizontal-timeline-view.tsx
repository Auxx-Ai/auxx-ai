// packages/ui/src/components/event-calendar/horizontal-timeline-view.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { addHours, endOfDay, format, isSameDay, isToday, startOfDay } from 'date-fns'
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { assignLanes } from './assign-lanes'
import {
  CurrentTimeLabelClass,
  TimelineHourWidth,
  TimelineHourWidthMax,
  TimelineHourWidthMin,
  TimelineLaneHeight,
  TimelineLaneHeightMax,
  TimelineLaneHeightMin,
  TimelineRailWidth,
  TimelineRailWidthMax,
  TimelineRailWidthMin,
  TimelineRowPadding,
} from './constants'
import { useDayStream } from './hooks/use-day-stream'
import { useCalendarSelection } from './selection/calendar-selection-context'
import { StickyRailShadow } from './sticky-rail-shadow'
import { type DayLaneAssignment, TimelineDaySection } from './timeline-day-section'
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

/** Below this px-per-hour, hour-tick labels thin to every 2nd hour (borders stay hourly). */
const HourLabelThinningWidth = 56

/** Multiplicative zoom gain per wheel `deltaY` unit (ctrl+wheel / trackpad pinch). */
const WheelZoomGain = 0.01

/** Idle time (ms) after the last ctrl+wheel event before the zoom commits. */
const WheelCommitDelayMs = 160

/** Stable empty default — an inline `[]` would break `TimelineDaySection`'s memo every scroll frame. */
const NoBackgroundEvents: BackgroundEvent[] = []

const clampHourWidth = (px: number) =>
  Math.min(TimelineHourWidthMax, Math.max(TimelineHourWidthMin, px))
const clampRailWidth = (px: number) =>
  Math.min(TimelineRailWidthMax, Math.max(TimelineRailWidthMin, px))
const clampLaneHeight = (px: number) =>
  Math.min(TimelineLaneHeightMax, Math.max(TimelineLaneHeightMin, px))

interface ZoomGesture {
  /** Live px-per-hour — flushed to `--tl-day-width` per move, committed to state on release. */
  hourWidth: number
  /** Live anchor compensation (px) — added into every day-section/header `translateX` calc so
   * the anchor point stays put visually while `scrollLeft` stays untouched (plan 35 §5.4). */
  comp: number
  /** Hours-from-stream-origin of the drag anchor — fixed for a border drag, `null` for wheel
   * (each wheel event re-derives its anchor from the pointer, drift-free). */
  anchorH: number | null
  startHourWidth: number
  startClientX: number
}

interface RailGesture {
  width: number
  startWidth: number
  startClientX: number
}

interface LaneGesture {
  /** Live lane height (px) — integer-stepped per move, committed on release. */
  height: number
  startHeight: number
  startClientY: number
  /** Total lane count above (and including) the grabbed row — the border's content-y is
   * `cumLanes × laneHeight + const`, so `Δheight = Δy / cumLanes` keeps it under the pointer. */
  cumLanes: number
}

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
  /** Controlled px-per-hour zoom (plan 35) — clamped to [`TimelineHourWidthMin`, `TimelineHourWidthMax`].
   * Omit for internal state. Gestures report commits via `onHourWidthChange`. */
  hourWidth?: number
  onHourWidthChange?: (px: number) => void
  /** Controlled worker-rail width (plan 35) — clamped to [`TimelineRailWidthMin`, `TimelineRailWidthMax`].
   * Omit for internal state. Drags report commits via `onRailWidthChange`. */
  railWidth?: number
  onRailWidthChange?: (px: number) => void
  /** Controlled lane height (plan 43) — clamped to [`TimelineLaneHeightMin`, `TimelineLaneHeightMax`].
   * Omit for internal state. Rail row-border drags report commits via `onLaneHeightChange`. */
  laneHeight?: number
  onLaneHeightChange?: (px: number) => void
  onEventSelect: (event: T, e: React.MouseEvent) => void
  /** Fires when a quarter-hour cell is clicked (§7 slot-create; also the empty-space clear-first
   * ordering the shared `onSlotClick` handler already enforces). */
  onSlotClick?: (startTime: Date, resourceId?: string) => void
  onEventResize?: (event: T, newStart: Date, newEnd: Date) => void
  renderEvent?: RenderEvent<T>
  /** Selected event ids (multi-selection, §3) — draws the in-color ring on membership. */
  selectedIds?: ReadonlySet<string>
  /** Fires when a user scroll settles on a new leftmost day. */
  onDateChange?: (date: Date) => void
  /** Fires with the rendered (visible + overscan) day window — consumers fetch this. */
  onVisibleRangeChange?: (from: Date, to: Date) => void
  /** Plan 42 — drop the day column for any date this returns true for (empty off-work days). */
  isDayHidden?: (date: Date) => boolean
}

/**
 * The horizontal dispatch-board timeline — worker rows × hours, time flowing left→right. Same
 * epoch/virtualizer day-stream shell as `ResourceTimelineView` (this IS `WeekView`/
 * `ResourceTimelineView`'s architecture, just rotated 90°): the virtualizer still counts days,
 * the sizing/settle-snap/scroll-anchor machinery is lifted near-verbatim. The differences are all
 * in what a rendered "day" looks like: instead of K vertical worker sub-columns inside an hour
 * grid, each day is `windowHours × hourWidth` wide and contains K horizontal worker rows whose
 * lane stacks (see `assignLanes`) can grow taller when visits overlap.
 *
 * **Zoom + rail resize (plan 35)**: `hourWidth` (px/hour) and `railWidth` are controlled props
 * with gesture support — hour-border drag and ctrl+wheel (trackpad pinch) rescale time, the
 * rail's right border drags its width. Gestures never setState per frame: all horizontal
 * geometry hangs off three CSS variables on the scroll container (`--tl-day-width`,
 * `--tl-rail-width`, `--tl-zoom-comp`) and day sections position themselves from their stream
 * `index` via `calc()`, so a gesture frame is two style-property writes. `--tl-zoom-comp` is the
 * anchor trick: instead of chasing `scrollLeft` (whose jumps would thrash the virtualizer's
 * mount set mid-gesture), the whole content plane is translated so the grabbed border / pointer
 * anchor stays put; release folds the compensation into one committed `scrollLeft` write.
 *
 * `dayWidth` is window-derived (`windowHours × hourWidth`), NOT clamp-derived — the sizing
 * effect only measures how much width is available (`avail`) to decide whether a full day fits
 * (`snapEnabled`); it never shrinks `dayWidth` itself the way `ResourceTimelineView`'s hybrid
 * clamp does.
 */
export function HorizontalTimelineView<T extends EventCalendarItem = EventCalendarItem>({
  currentDate,
  events,
  resources,
  weekStartsOn: _weekStartsOn,
  backgroundEvents = NoBackgroundEvents,
  hourWindow,
  hourWidth: hourWidthProp,
  onHourWidthChange,
  railWidth: railWidthProp,
  onRailWidthChange,
  laneHeight: laneHeightProp,
  onLaneHeightChange,
  onEventSelect,
  onSlotClick,
  onEventResize,
  renderEvent,
  selectedIds,
  onDateChange,
  onVisibleRangeChange,
  isDayHidden,
}: HorizontalTimelineViewProps<T>) {
  const selection = useCalendarSelection()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [viewportHeight, setViewportHeight] = useState(0)

  // Controlled-or-internal zoom/rail state — web passes the persisted store values; standalone
  // usage still gets working gestures.
  const [internalHourWidth, setInternalHourWidth] = useState(TimelineHourWidth)
  const [internalRailWidth, setInternalRailWidth] = useState(TimelineRailWidth)
  const [internalLaneHeight, setInternalLaneHeight] = useState(TimelineLaneHeight)
  const hourWidth = clampHourWidth(hourWidthProp ?? internalHourWidth)
  const railWidth = clampRailWidth(railWidthProp ?? internalRailWidth)
  const laneHeight = clampLaneHeight(laneHeightProp ?? internalLaneHeight)

  const windowStart = hourWindow.start
  const windowEnd = hourWindow.end
  const windowHours = Math.max(0, windowEnd - windowStart)
  const dayWidth = Math.max(1, windowHours * hourWidth)

  const { dayCount, dayAt, dayIndexOf, slotsVersion } = useDayStream(isDayHidden)

  // The virtualizer reads day size through a ref so a throttle-free `measure()` after a zoom
  // commit sees the new width without waiting for a state-closure refresh (plan 35 §5.5).
  const dayWidthRef = useRef(dayWidth)
  dayWidthRef.current = dayWidth

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: dayCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => dayWidthRef.current, []),
    overscan: 1,
  })

  // ── gesture plumbing (plan 35) ───────────────────────────────────────────
  // Live gesture state lives in refs; committed values live in props/state. `applyCssVars` is
  // idempotent and re-run as a layout effect on EVERY render, so an unrelated re-render
  // mid-gesture (the 60s now-tick, a realtime event update) can never clobber gesture geometry —
  // React writes the committed style attr, then this re-asserts the live values pre-paint.
  const zoomGestureRef = useRef<ZoomGesture | null>(null)
  const railGestureRef = useRef<RailGesture | null>(null)
  const laneGestureRef = useRef<LaneGesture | null>(null)
  const pendingScrollLeftRef = useRef<number | null>(null)
  const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Committed geometry + commit callbacks behind refs so the stable wheel listener and
  // timer-fired commits never read stale closures.
  const geoRef = useRef({ hourWidth, railWidth, laneHeight, windowHours })
  geoRef.current = { hourWidth, railWidth, laneHeight, windowHours }
  const commitCallbacksRef = useRef({ onHourWidthChange, onRailWidthChange, onLaneHeightChange })
  commitCallbacksRef.current = { onHourWidthChange, onRailWidthChange, onLaneHeightChange }

  const applyCssVars = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const liveHourWidth = zoomGestureRef.current?.hourWidth ?? geoRef.current.hourWidth
    const liveRailWidth = railGestureRef.current?.width ?? geoRef.current.railWidth
    const liveLaneHeight = laneGestureRef.current?.height ?? geoRef.current.laneHeight
    const comp = zoomGestureRef.current?.comp ?? 0
    el.style.setProperty(
      '--tl-day-width',
      `${Math.max(1, geoRef.current.windowHours * liveHourWidth)}px`
    )
    el.style.setProperty('--tl-rail-width', `${liveRailWidth}px`)
    el.style.setProperty('--tl-lane-height', `${liveLaneHeight}px`)
    el.style.setProperty('--tl-zoom-comp', `${comp}px`)
  }, [])

  // No dependency array — deliberately runs every render (see above).
  useLayoutEffect(applyCssVars)

  const commitHourWidth = useCallback((px: number) => {
    const cb = commitCallbacksRef.current.onHourWidthChange
    if (cb) cb(px)
    else setInternalHourWidth(px)
  }, [])

  const commitRailWidth = useCallback((px: number) => {
    const cb = commitCallbacksRef.current.onRailWidthChange
    if (cb) cb(px)
    else setInternalRailWidth(px)
  }, [])

  const commitLaneHeight = useCallback((px: number) => {
    const cb = commitCallbacksRef.current.onLaneHeightChange
    if (cb) cb(px)
    else setInternalLaneHeight(px)
  }, [])

  // ── sizing: dayWidth is window-derived (see above) — this effect only measures how much width
  // is available beside the rail, to decide whether a full day fits (snapEnabled).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const applySize = () => {
      const avail = Math.max(1, el.clientWidth - railWidth)
      setSnapEnabled(dayWidth <= avail)
      // Body min-height: the row/day grid stretches to fill the viewport even with few workers.
      setViewportHeight(el.clientHeight)
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [dayWidth, railWidth])

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
  // A slot-mapping change (off-day hidden/revealed, plan 42) shifts which day a fixed scrollLeft
  // shows — force a re-anchor even when parked, since the guard below would otherwise skip it.
  const lastSlotsVersionRef = useRef(slotsVersion)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Zoom-commit path (plan 35 §5.5): the gesture already computed the anchor-correct
    // scrollLeft (current scroll minus the folded-away `--tl-zoom-comp`) — consume it INSTEAD
    // of the hour-window re-anchor below, which would yank the view to `currentDate`'s left
    // edge on every zoom release.
    if (pendingScrollLeftRef.current !== null) {
      const target = pendingScrollLeftRef.current
      pendingScrollLeftRef.current = null
      lastDayWidthRef.current = dayWidth
      programmaticScrollRef.current = true
      el.scrollTo({ left: target })
      lastScrollLeftRef.current = target
      const timeout = setTimeout(() => {
        programmaticScrollRef.current = false
      }, 300)
      return () => clearTimeout(timeout)
    }
    const dayWidthChanged = lastDayWidthRef.current !== dayWidth
    const slotsChanged = lastSlotsVersionRef.current !== slotsVersion
    lastSlotsVersionRef.current = slotsVersion
    if (
      !dayWidthChanged &&
      !slotsChanged &&
      lastEmittedDateRef.current === currentDateRef.current.getTime()
    )
      return
    lastDayWidthRef.current = dayWidth
    programmaticScrollRef.current = true
    const targetOffset = targetIndex * dayWidth
    el.scrollTo({ left: targetOffset })
    lastScrollLeftRef.current = targetOffset
    const timeout = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 300)
    return () => clearTimeout(timeout)
  }, [targetIndex, dayWidth, slotsVersion])

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
      // Gesture scroll writes (rail drags nudge scrollLeft live) must not settle-snap.
      if (zoomGestureRef.current || railGestureRef.current) return
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

  // ── zoom gestures (plan 35 §5) ───────────────────────────────────────────

  /** Ends the active zoom gesture: folds `--tl-zoom-comp` into one committed scrollLeft. */
  const finishZoomGesture = useCallback(() => {
    const gesture = zoomGestureRef.current
    if (!gesture) return
    clearTimeout(wheelCommitTimerRef.current)
    zoomGestureRef.current = null
    const el = scrollRef.current
    if (!el) return

    // The committed value is an INTEGER while the live gesture value (wheel path: ×e^Δ) is
    // fractional. The fold-away scrollLeft must be derived for the width actually committed —
    // a naive `scrollLeft − comp` assumes the live width sticks, and the mismatch is
    // (live − committed) × hoursFromStreamOrigin ≈ THOUSANDS of px (days) per 0.5px/hr of
    // rounding. Anchor instead on the time-point at the viewport's left edge, computed from the
    // LIVE visual state, and re-project it at the committed width — exact for any rounding.
    const finalHourWidth = clampHourWidth(Math.round(gesture.hourWidth))
    const rail = railGestureRef.current?.width ?? geoRef.current.railWidth
    const hoursAtViewportLeft = (el.scrollLeft - gesture.comp - rail) / gesture.hourWidth
    const target = rail + finalHourWidth * hoursAtViewportLeft

    if (finalHourWidth === geoRef.current.hourWidth) {
      // Rounds back to the already-committed width — no re-render will consume a pending
      // scrollLeft, so fold the (possibly non-zero) comp imperatively: committed vars + the
      // re-projected scrollLeft in the same frame. Skipping this and just re-asserting vars
      // would discard comp and jump the view by days.
      programmaticScrollRef.current = true
      applyCssVars()
      el.scrollLeft = target
      lastScrollLeftRef.current = target
      setTimeout(() => {
        programmaticScrollRef.current = false
      }, 200)
      return
    }

    pendingScrollLeftRef.current = target
    commitHourWidth(finalHourWidth)
  }, [applyCssVars, commitHourWidth])

  /** Border drag: the grabbed hour's LEFT edge is the anchor, so the dragged border tracks the
   * pointer exactly (`hourWidth' = start + dx` puts it one hour-width right of the anchor). */
  const beginBorderZoom = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, dayIndex: number, hourIndex: number) => {
      const { hourWidth: committed, windowHours: wh } = geoRef.current
      // A commit is mid-flight (pending scrollLeft not yet consumed by the re-render) —
      // starting a gesture now would seed from stale committed values. Next attempt re-enters.
      if (wh <= 0 || pendingScrollLeftRef.current !== null) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      zoomGestureRef.current = {
        hourWidth: committed,
        comp: 0,
        anchorH: dayIndex * wh + hourIndex - 1,
        startHourWidth: committed,
        startClientX: e.clientX,
      }
    },
    []
  )

  const moveBorderZoom = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = zoomGestureRef.current
      if (!gesture || gesture.anchorH === null) return
      e.stopPropagation()
      const next = clampHourWidth(gesture.startHourWidth + (e.clientX - gesture.startClientX))
      if (next === gesture.hourWidth) return
      gesture.hourWidth = next
      gesture.comp = (gesture.startHourWidth - next) * gesture.anchorH
      applyCssVars()
    },
    [applyCssVars]
  )

  const endBorderZoom = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!zoomGestureRef.current || zoomGestureRef.current.anchorH === null) return
      e.stopPropagation()
      finishZoomGesture()
    },
    [finishZoomGesture]
  )

  /** Double-click an hour border → reset to the default scale, keeping that border stationary. */
  const resetZoom = useCallback(
    (dayIndex: number, hourIndex: number) => {
      const { hourWidth: committed, windowHours: wh } = geoRef.current
      if (wh <= 0 || committed === TimelineHourWidth) return
      if (pendingScrollLeftRef.current !== null) return
      const el = scrollRef.current
      if (!el) return
      const anchorH = dayIndex * wh + hourIndex
      pendingScrollLeftRef.current = el.scrollLeft + (TimelineHourWidth - committed) * anchorH
      commitHourWidth(TimelineHourWidth)
    },
    [commitHourWidth]
  )

  // Ctrl+wheel / trackpad pinch — non-passive so `preventDefault` can stop the browser's page
  // zoom. Each event re-derives its anchor (the time under the pointer) from LIVE values, so
  // continuous pinches stay drift-free; the commit debounces behind the last event.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      const { railWidth: committedRail, windowHours: wh } = geoRef.current
      if (wh <= 0) return
      e.preventDefault()
      // A commit is mid-flight — swallow this event (still prevented from page-zooming); the
      // next one starts a fresh gesture from the settled committed state.
      if (pendingScrollLeftRef.current !== null) return
      let gesture = zoomGestureRef.current
      if (!gesture) {
        gesture = {
          hourWidth: geoRef.current.hourWidth,
          comp: 0,
          anchorH: null,
          startHourWidth: geoRef.current.hourWidth,
          startClientX: 0,
        }
        zoomGestureRef.current = gesture
      }
      const liveRail = railGestureRef.current?.width ?? committedRail
      const pointerX = e.clientX - el.getBoundingClientRect().left
      // Hours-from-stream-origin of the content point under the pointer, in live scale.
      const anchorH = (el.scrollLeft + pointerX - liveRail - gesture.comp) / gesture.hourWidth
      const next = clampHourWidth(gesture.hourWidth * Math.exp(-e.deltaY * WheelZoomGain))
      gesture.comp += (gesture.hourWidth - next) * anchorH
      gesture.hourWidth = next
      applyCssVars()
      clearTimeout(wheelCommitTimerRef.current)
      wheelCommitTimerRef.current = setTimeout(finishZoomGesture, WheelCommitDelayMs)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(wheelCommitTimerRef.current)
    }
  }, [applyCssVars, finishZoomGesture])

  // ── rail resize gesture (plan 35 §4) ─────────────────────────────────────
  // Growing the rail shifts all content right by Δ; a matching scrollLeft nudge keeps the same
  // time under the viewport edge (the rail expands over the seam, sidebar-style). scrollLeft
  // moves live here (small, bounded deltas — no virtualizer hazard), guarded from the settle
  // handler by the gesture-ref check above.
  const beginRailResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pendingScrollLeftRef.current !== null) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const committed = geoRef.current.railWidth
    railGestureRef.current = { width: committed, startWidth: committed, startClientX: e.clientX }
  }, [])

  const moveRailResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = railGestureRef.current
      if (!gesture) return
      e.stopPropagation()
      const next = clampRailWidth(gesture.startWidth + (e.clientX - gesture.startClientX))
      const delta = next - gesture.width
      if (delta === 0) return
      gesture.width = next
      applyCssVars()
      const el = scrollRef.current
      if (el) el.scrollLeft += delta
    },
    [applyCssVars]
  )

  const endRailResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = railGestureRef.current
      if (!gesture) return
      e.stopPropagation()
      railGestureRef.current = null
      const el = scrollRef.current
      if (el) lastScrollLeftRef.current = el.scrollLeft
      if (gesture.width !== geoRef.current.railWidth) commitRailWidth(gesture.width)
      else applyCssVars()
    },
    [applyCssVars, commitRailWidth]
  )

  /** Double-click the rail border → reset to the default width, content staying anchored. */
  const resetRail = useCallback(() => {
    const committed = geoRef.current.railWidth
    if (committed === TimelineRailWidth) return
    const el = scrollRef.current
    if (el) {
      programmaticScrollRef.current = true
      el.scrollLeft += TimelineRailWidth - committed
      lastScrollLeftRef.current = el.scrollLeft
      setTimeout(() => {
        programmaticScrollRef.current = false
      }, 200)
    }
    commitRailWidth(TimelineRailWidth)
  }, [commitRailWidth])

  const railResizeHandleProps = {
    onPointerDown: beginRailResize,
    onPointerMove: moveRailResize,
    onPointerUp: endRailResize,
    onPointerCancel: endRailResize,
    onDoubleClick: resetRail,
    // Landmine for the marquee's pointerdown guard — a class-based selector here would be
    // fragile against the two render sites (corner + body segments) below.
    'data-marquee-ignore': true,
  }

  // ── lane-height gesture (plan 43) ────────────────────────────────────────
  // Dragging ANY rail row's bottom border rescales the GLOBAL lane height. The grabbed border's
  // content-y is `cumLanes × laneHeight + const`, so `Δheight = Δy / cumLanes` keeps the border
  // under the pointer with no scroll compensation; integer-stepping the live value means the
  // release commit changes nothing visually. Live geometry rides `--tl-lane-height` (see the
  // row-geometry comment below) — a move is one style write, zero re-renders. The ref's
  // `.current` is (re)assigned AFTER the row-geometry memo below — `beginLaneResize` only reads
  // it at pointer-down time.
  const laneGeomRef = useRef<{ rowLaneCounts: number[]; rowLaneStarts: number[] }>({
    rowLaneCounts: [],
    rowLaneStarts: [],
  })

  const beginLaneResize = useCallback((e: React.PointerEvent<HTMLDivElement>, ri: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const committed = geoRef.current.laneHeight
    const { rowLaneCounts: counts, rowLaneStarts: starts } = laneGeomRef.current
    laneGestureRef.current = {
      height: committed,
      startHeight: committed,
      startClientY: e.clientY,
      cumLanes: Math.max(1, (starts[ri] ?? 0) + (counts[ri] ?? 1)),
    }
  }, [])

  const moveLaneResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = laneGestureRef.current
      if (!gesture) return
      e.stopPropagation()
      const next = clampLaneHeight(
        Math.round(gesture.startHeight + (e.clientY - gesture.startClientY) / gesture.cumLanes)
      )
      if (next === gesture.height) return
      gesture.height = next
      applyCssVars()
    },
    [applyCssVars]
  )

  const endLaneResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const gesture = laneGestureRef.current
      if (!gesture) return
      e.stopPropagation()
      laneGestureRef.current = null
      if (gesture.height !== geoRef.current.laneHeight) commitLaneHeight(gesture.height)
      else applyCssVars()
    },
    [applyCssVars, commitLaneHeight]
  )

  /** Double-click a row border → reset to the default lane height. */
  const resetLaneHeight = useCallback(() => {
    if (geoRef.current.laneHeight !== TimelineLaneHeight) commitLaneHeight(TimelineLaneHeight)
  }, [commitLaneHeight])

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
  // Lane assignments are keyed `${resourceId}|${dayISOString}` (not just `resourceId`): a
  // multi-day event can land in a different lane on each day segment it spans, so the day must
  // be part of the key — see `TimelineDaySection`'s doc comment. Each value carries `laneCount`
  // too, which the section needs to center that day's stack in the row (plan 35 §1).
  const { rowLaneCounts, rowLaneStarts, laneMapsByResource } = useMemo(() => {
    const laneMapsByResource = new Map<string, DayLaneAssignment>()
    const rowLaneCounts: number[] = []

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
          laneMapsByResource.set(`${resource.id}|${day.toISOString()}`, { lanes, laneCount })
          if (laneCount > maxLanes) maxLanes = laneCount
        }
      }
      rowLaneCounts.push(maxLanes)
    }

    const rowLaneStarts: number[] = []
    let acc = 0
    for (const count of rowLaneCounts) {
      rowLaneStarts.push(acc)
      acc += count
    }

    return { rowLaneCounts, rowLaneStarts, laneMapsByResource }
  }, [resources, events, firstIndex, lastIndex, dayAt, windowStart, windowEnd])
  laneGeomRef.current = { rowLaneCounts, rowLaneStarts }

  // All vertical row geometry hangs off `--tl-lane-height` via calc() over gesture-STABLE lane
  // counts (plan 43, mirroring plan 35 §5.4's x-axis trick) — a lane-height drag frame is one
  // style-property write, zero section re-renders.
  const totalLanes = rowLaneCounts.reduce((sum, count) => sum + count, 0)
  const rowTopExpr = (ri: number) =>
    `calc(${rowLaneStarts[ri] ?? 0} * var(--tl-lane-height) + ${ri * TimelineRowPadding}px)`
  const rowHeightExpr = (ri: number) =>
    `calc(${rowLaneCounts[ri] ?? 1} * var(--tl-lane-height) + ${TimelineRowPadding}px)`
  const headerHeight = DateLabelHeight + HourTickHeight
  // The body (rows + day sections + their vertical day borders) fills at least the visible
  // viewport below the header — the grid never stops short above empty screen space.
  const bodyHeightExpr = `max(calc(${totalLanes} * var(--tl-lane-height) + ${
    resources.length * TimelineRowPadding
  }px), ${Math.max(0, viewportHeight - headerHeight)}px)`

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

  const hourTicks = windowHours > 0 ? Math.round(windowHours) : 0
  // Tick-label thinning at small scales — every hour still gets its border (the grab surface).
  const hourLabelStep = hourWidth < HourLabelThinningWidth ? 2 : 1

  // Shared calc() for the per-day x offset — headers and day sections use the same expression
  // so gestures move them in lockstep.
  const dayTranslateX = (index: number) =>
    `translateX(calc(var(--tl-rail-width) + ${index} * var(--tl-day-width) + var(--tl-zoom-comp, 0px)))`

  return (
    <div data-slot='horizontal-timeline-view' className='flex min-h-0 flex-1 flex-col'>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className='min-h-0 flex-1 overflow-auto'
        style={
          {
            // Committed geometry — the always-run layout effect re-asserts live gesture values
            // on top of these pre-paint (see `applyCssVars`).
            '--tl-day-width': `${dayWidth}px`,
            '--tl-rail-width': `${railWidth}px`,
            '--tl-lane-height': `${laneHeight}px`,
            '--tl-zoom-comp': '0px',
          } as CSSProperties
        }>
        <div
          className='relative'
          style={{
            width: `calc(var(--tl-rail-width) + ${dayCount} * var(--tl-day-width))`,
            minHeight: `calc(${headerHeight}px + ${bodyHeightExpr})`,
          }}>
          {/* Two-tier sticky header: date labels + hour ticks. */}
          <div
            className='bg-background/80 border-border/70 sticky top-0 z-30 border-b backdrop-blur-md'
            style={{ height: headerHeight }}>
            {/* Corner — sticky on both axes: pinned left within the (already sticky-top) strip. */}
            <div
              className='bg-background text-muted-foreground/70 sticky left-0 z-10 flex items-center justify-center text-sm'
              style={{ width: 'var(--tl-rail-width)', height: headerHeight }}>
              <span className='max-[479px]:sr-only'>{format(new Date(), 'O')}</span>
              {/* Rail-width drag handle (corner segment) — one continuous strip with the rail's. */}
              <div
                {...railResizeHandleProps}
                className='hover:bg-border/70 absolute inset-y-0 right-0 z-20 w-[5px] cursor-col-resize touch-none select-none'
              />
              <StickyRailShadow />
            </div>

            {/* Row 1 — per-day date label, spanning the whole day-section width, centered. */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const today = isToday(day)
              return (
                <div
                  key={`label-${v.key}`}
                  // Cmd/ctrl+click the day header grabs the whole day's events into the
                  // selection (§3.2), across every worker row.
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
                    width: 'var(--tl-day-width)',
                    height: DateLabelHeight,
                    transform: dayTranslateX(v.index),
                  }}>
                  <span className='uppercase'>{format(day, 'EEE')}</span>
                  {/* Today's date sits in a filled pill (Notion look); other days stay plain. */}
                  <span
                    className={cn(
                      'flex h-6 items-center justify-center rounded-full px-2 whitespace-nowrap tabular-nums',
                      today
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-foreground font-medium'
                    )}>
                    {format(day, 'MMM d')}
                  </span>
                </div>
              )
            })}

            {/* Row 2 — hour tick labels, the zoom grab strips on each hour border, and the
                now-pill on today. */}
            {virtualItems.map((v) => {
              const day = dayAt(v.index)
              const today = isToday(day)
              return (
                <div
                  key={`ticks-${v.key}`}
                  className='border-border/70 absolute border-l text-[10px]'
                  style={{
                    top: DateLabelHeight,
                    left: 0,
                    width: 'var(--tl-day-width)',
                    height: HourTickHeight,
                    transform: dayTranslateX(v.index),
                  }}>
                  {Array.from({ length: hourTicks }, (_, hourIndex) => {
                    const tickDate = addHours(startOfDay(day), windowStart + hourIndex)
                    return (
                      <div
                        key={hourIndex}
                        className='border-border/50 text-muted-foreground/70 absolute top-0 h-full border-l pl-1 font-medium first:border-l-0'
                        style={{
                          left: `${(hourIndex / windowHours) * 100}%`,
                          width: `${100 / windowHours}%`,
                        }}>
                        {hourIndex % hourLabelStep === 0 ? format(tickDate, 'h a') : null}
                      </div>
                    )
                  })}
                  {/* Zoom grab strips — one per hour border (incl. the day boundary at index 0).
                      Drag = rescale px-per-hour anchored so the border tracks the pointer;
                      double-click = reset to the default scale. */}
                  {Array.from({ length: hourTicks }, (_, hourIndex) => (
                    <div
                      key={`zoom-${hourIndex}`}
                      onPointerDown={(e) => beginBorderZoom(e, v.index, hourIndex)}
                      onPointerMove={moveBorderZoom}
                      onPointerUp={endBorderZoom}
                      onPointerCancel={endBorderZoom}
                      onDoubleClick={() => resetZoom(v.index, hourIndex)}
                      data-marquee-ignore
                      className='absolute inset-y-0 z-10 w-[7px] cursor-ew-resize touch-none select-none'
                      style={{ left: `calc(${(hourIndex / windowHours) * 100}% - 3px)` }}
                    />
                  ))}
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
            className='bg-background sticky left-0 z-20'
            style={{ width: 'var(--tl-rail-width)' }}>
            <div className='relative' style={{ height: bodyHeightExpr }}>
              {resources.map((resource, ri) => (
                <div
                  key={resource.id}
                  className='border-border/70 text-muted-foreground/80 absolute right-0 left-0 flex items-center border-b px-2 text-sm'
                  style={{
                    top: rowTopExpr(ri),
                    height: rowHeightExpr(ri),
                  }}>
                  {resource.header ?? resource.label}
                  {/* Lane-height drag handle — the row's bottom border (plan 43). Any row's
                      border rescales the global lane height; double-click resets. */}
                  <div
                    onPointerDown={(e) => beginLaneResize(e, ri)}
                    onPointerMove={moveLaneResize}
                    onPointerUp={endLaneResize}
                    onPointerCancel={endLaneResize}
                    onDoubleClick={resetLaneHeight}
                    data-marquee-ignore
                    className='hover:bg-border/70 absolute inset-x-0 -bottom-[2px] z-20 h-[5px] cursor-row-resize touch-none select-none'
                  />
                </div>
              ))}
              {/* Rail-width drag handle (body segment). */}
              <div
                {...railResizeHandleProps}
                className='hover:bg-border/70 absolute inset-y-0 right-0 z-20 w-[5px] cursor-col-resize touch-none select-none'
              />
              <StickyRailShadow />
            </div>
          </div>

          {virtualItems.map((v) => (
            <TimelineDaySection
              key={v.key}
              index={v.index}
              top={headerHeight}
              dayAt={dayAt}
              resources={resources}
              events={events}
              backgroundEvents={backgroundEvents}
              hourWindow={hourWindow}
              hourWidth={hourWidth}
              laneHeight={laneHeight}
              rowLaneCounts={rowLaneCounts}
              rowLaneStarts={rowLaneStarts}
              bodyHeight={bodyHeightExpr}
              laneMapsByResource={laneMapsByResource}
              onEventSelect={onEventSelect}
              onSlotClick={onSlotClick}
              onEventResize={onEventResize}
              renderEvent={renderEvent}
              selectedIds={selectedIds}
              nowPosition={nowPosition}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

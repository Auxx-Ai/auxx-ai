// packages/ui/src/components/event-calendar/selection/calendar-selection-context.tsx

'use client'

import { createContext, type ReactNode, useContext, useRef } from 'react'
import type { EventCalendarItem } from '../types'

/** The slot last hovered by the pointer — feeds paste-anchor/context-menu targeting (later
 * phases). Ref-only, never a re-render (see `reportHoveredSlot`). */
export interface HoveredSlot {
  date: Date
  time?: number
  resourceId?: string
}

/** The subset of a DOM/pointer event `handleChipClick`/`handleDayGrab` read — both a React
 * `MouseEvent` and a raw `PointerEvent` satisfy this, so the engine works from either. */
interface ModifierEvent {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey?: boolean
  preventDefault?: () => void
  stopPropagation?: () => void
}

/**
 * The generic multi-selection engine for one `EventCalendar` mount (plan
 * `37c-calendar-create-copy-paste.md` §3) — one stable object per calendar instance holding the
 * selection anchor, the chip DOM registry (for marquee hit-testing), and the hovered-slot ref,
 * plus the gesture-interpretation functions every view/chip calls into instead of branching
 * modifier keys itself. Selection STATE is NOT owned here — `selectedIds` is a live snapshot of
 * the consumer's controlled `selectedEventIds` prop; every mutator ends by calling
 * `emitSelection`/`onSelectionChange`, never by writing local state.
 */
export interface CalendarSelectionEngine {
  hoveredSlotRef: React.MutableRefObject<HoveredSlot | null>
  /** Pointer-enter feed for the hovered slot — ref-only, zero re-renders. */
  reportHoveredSlot: (slot: HoveredSlot) => void
  /** Chips self-register their DOM element on mount (`draggable-event.tsx`, agenda's chip) so
   * the marquee can hit-test their client rects without a React re-render per frame. */
  registerChip: (id: string, element: HTMLElement) => void
  unregisterChip: (id: string) => void
  getChipRegistry: () => Map<string, HTMLElement>
  /** Live snapshot of the controlled `selectedEventIds` prop, for callers (the marquee) that
   * need to read it outside a render (inside a rAF-throttled pointer handler). */
  getSelectedIds: () => ReadonlySet<string>
  /** Replaces the selection wholesale — the marquee's per-frame commit. */
  emitSelection: (ids: Set<string>) => void
  /** Clears the selection and resets the shift-range anchor (Escape, click-away). */
  clearSelection: () => void
  /** Marks a marquee release so the very next `handleEmptyClick` swallows the synthetic click
   * the browser fires on release instead of treating it as a plain empty-space click. */
  markMarqueeReleased: () => void
  /**
   * Central click-gesture interpretation for a chip (§3.2): plain click replaces the selection
   * and moves the anchor; cmd/ctrl+click toggles membership; shift+click extends a chronological
   * range from the anchor (cmd+shift unions it into the existing selection). Returns `true` only
   * for a plain click — callers use that to decide whether to also fire `onEventClick`
   * (cmd/shift clicks manage selection only, never open a popover/drawer).
   */
  handleChipClick: (id: string, e: ModifierEvent) => boolean
  /**
   * Click on empty grid space (plan 44 — clear-only): a non-empty selection is cleared and the
   * click is swallowed; an empty selection is a no-op (create moved to double-click / cmd+drag).
   * Also swallows the synthetic click that follows a marquee release (`markMarqueeReleased`).
   */
  handleEmptyClick: () => void
  /**
   * Cmd/ctrl+click a day (month cell/date label, or a week/day/timeline day header): toggles
   * every id in `dayEventIds` into the selection — all-selected clears them, otherwise unions
   * them in. No-ops (returns `false`) without a held modifier, so callers can fall through to
   * whatever else that click target does.
   */
  handleDayGrab: (dayEventIds: string[], e: ModifierEvent) => boolean
}

function noop() {}

/** Default context value — only used if a consumer reads `useCalendarSelection` outside an
 * `EventCalendar` mount (defensive; `EventCalendar` always provides a real engine). */
const DefaultEngine: CalendarSelectionEngine = {
  hoveredSlotRef: { current: null },
  reportHoveredSlot: noop,
  registerChip: noop,
  unregisterChip: noop,
  getChipRegistry: () => new Map(),
  getSelectedIds: () => new Set(),
  emitSelection: noop,
  clearSelection: noop,
  markMarqueeReleased: noop,
  handleChipClick: () => true,
  handleEmptyClick: noop,
  handleDayGrab: () => false,
}

const CalendarSelectionContext = createContext<CalendarSelectionEngine>(DefaultEngine)

/** Reads the current calendar's selection engine — chips, droppable cells, and day headers call
 * this to register/report/grab without threading selection props through every view. */
export function useCalendarSelection(): CalendarSelectionEngine {
  return useContext(CalendarSelectionContext)
}

/**
 * Builds the selection engine for one `EventCalendar` mount. Called directly by
 * `EventCalendarInner` (not by `CalendarSelectionProvider`) so the shell's own
 * `handleEventSelect`/`handleSlotClick` can call the SAME engine instance its descendants read
 * via context — a component can't consume a context it renders below itself, so the engine has
 * to be created above the provider, then handed to it.
 *
 * The returned object's identity is stable for the component's lifetime (built once via a lazy
 * ref) — every live input (`events`, `selectedIds`, `onSelectionChange`) is threaded through
 * refs instead, so context consumers never re-render merely because the engine "changed".
 */
export function useCalendarSelectionEngine<T extends EventCalendarItem>(
  events: T[],
  selectedIds: ReadonlySet<string>,
  onSelectionChange?: (ids: string[]) => void,
  /** Plan 37c §4 — an optional consumer-owned ref that mirrors every hovered-slot report
   * alongside the engine's own internal one. Lets the paste anchor live OUTSIDE the calendar
   * (a board-level Cmd+V handler, a right-click menu) without threading hover state through
   * `onSelectionChange`-shaped props. Written in the same call as the internal ref — never a
   * re-render on its own. */
  externalHoveredSlotRef?: React.MutableRefObject<HoveredSlot | null>
): CalendarSelectionEngine {
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const externalHoveredSlotRefRef = useRef(externalHoveredSlotRef)
  externalHoveredSlotRefRef.current = externalHoveredSlotRef
  const anchorIdRef = useRef<string | null>(null)
  const registryRef = useRef<Map<string, HTMLElement>>(new Map())
  const hoveredSlotRef = useRef<HoveredSlot | null>(null)
  const marqueeSuppressRef = useRef(false)

  // Sorted-by-start once per `events` identity change — shift-range needs a stable chronological
  // order, and re-sorting inside every click handler would be wasteful for large event lists.
  const sortedCacheRef = useRef<{ events: T[]; sorted: EventCalendarItem[] }>({
    events,
    sorted: [],
  })
  if (sortedCacheRef.current.events !== events) {
    sortedCacheRef.current = {
      events,
      sorted: [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    }
  }
  const sortedEventsRef = useRef<EventCalendarItem[]>(sortedCacheRef.current.sorted)
  sortedEventsRef.current = sortedCacheRef.current.sorted

  const engineRef = useRef<CalendarSelectionEngine | null>(null)
  if (!engineRef.current) {
    const emit = (next: Set<string>) => onSelectionChangeRef.current?.(Array.from(next))

    engineRef.current = {
      hoveredSlotRef,
      reportHoveredSlot: (slot) => {
        hoveredSlotRef.current = slot
        if (externalHoveredSlotRefRef.current) externalHoveredSlotRefRef.current.current = slot
      },
      registerChip: (id, element) => {
        registryRef.current.set(id, element)
      },
      unregisterChip: (id) => {
        registryRef.current.delete(id)
      },
      getChipRegistry: () => registryRef.current,
      getSelectedIds: () => selectedIdsRef.current,
      emitSelection: emit,
      clearSelection: () => {
        anchorIdRef.current = null
        emit(new Set())
      },
      markMarqueeReleased: () => {
        marqueeSuppressRef.current = true
        // The synthetic click a release produces dispatches before timers run, so this disarms
        // the swallow immediately after that click's window — a release over a chip or outside
        // the grid (whose click never reaches `handleEmptyClick`) can't leave the flag armed to
        // eat the NEXT legitimate empty-space click.
        setTimeout(() => {
          marqueeSuppressRef.current = false
        }, 0)
      },
      handleChipClick: (id, e) => {
        const isMeta = e.metaKey || e.ctrlKey
        const isShift = Boolean(e.shiftKey)
        const current = selectedIdsRef.current

        if (isShift) {
          // Prevents the browser's native text-selection drag artifact shift-click can trigger.
          e.preventDefault?.()
          const anchor = anchorIdRef.current
          const sorted = sortedEventsRef.current
          const anchorIndex = anchor ? sorted.findIndex((ev) => ev.id === anchor) : -1
          const clickedIndex = sorted.findIndex((ev) => ev.id === id)
          const rangeIds =
            anchorIndex === -1 || clickedIndex === -1
              ? [id]
              : sorted
                  .slice(
                    Math.min(anchorIndex, clickedIndex),
                    Math.max(anchorIndex, clickedIndex) + 1
                  )
                  .map((ev) => ev.id)
          const next = isMeta ? new Set(current) : new Set<string>()
          for (const rangeId of rangeIds) next.add(rangeId)
          // Finder semantics: the anchor stays put across repeated shift-clicks so the range
          // always measures from the FIRST click, not the last.
          if (!anchor) anchorIdRef.current = id
          emit(next)
          return false
        }

        if (isMeta) {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          anchorIdRef.current = id
          emit(next)
          return false
        }

        anchorIdRef.current = id
        emit(new Set([id]))
        return true
      },
      handleEmptyClick: () => {
        if (marqueeSuppressRef.current) {
          marqueeSuppressRef.current = false
          return
        }
        if (selectedIdsRef.current.size > 0) {
          anchorIdRef.current = null
          emit(new Set())
        }
      },
      handleDayGrab: (dayEventIds, e) => {
        if (!(e.metaKey || e.ctrlKey)) return false
        e.preventDefault?.()
        e.stopPropagation?.()
        if (dayEventIds.length === 0) return true
        const current = selectedIdsRef.current
        const allSelected = dayEventIds.every((id) => current.has(id))
        const next = new Set(current)
        for (const id of dayEventIds) {
          if (allSelected) next.delete(id)
          else next.add(id)
        }
        anchorIdRef.current = dayEventIds[dayEventIds.length - 1] ?? anchorIdRef.current
        emit(next)
        return true
      },
    }
  }

  return engineRef.current
}

/**
 * Publishes an already-built engine (see `useCalendarSelectionEngine`) to descendants — a thin
 * context wrapper, not the state owner, so `EventCalendarInner` can use the same engine instance
 * for its own gesture handlers that this provider hands to the view tree below it.
 */
export function CalendarSelectionProvider({
  engine,
  children,
}: {
  engine: CalendarSelectionEngine
  children: ReactNode
}) {
  return (
    <CalendarSelectionContext.Provider value={engine}>{children}</CalendarSelectionContext.Provider>
  )
}

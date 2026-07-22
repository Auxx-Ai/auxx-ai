// apps/web/src/components/dispatch/ui/board/board-calendar-grid.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@auxx/ui/components/context-menu'
import {
  type BackgroundEvent,
  type CalendarResource,
  DefaultStartHour,
  EventCalendar,
  EventPopover,
  type HoveredSlot,
  type RenderEventContext,
  type SlotCreateIntent,
} from '@auxx/ui/components/event-calendar'
import { addMinutes, format } from 'date-fns'
import { Ban, CalendarPlus, ClipboardPaste, Copy, Inbox, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import { useTimelineViewStore } from '../../stores/timeline-view-store'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { BoardAssignContextSubmenu } from './board-assign-context-submenu'
import type { BoardBulkActions } from './hooks/use-board-bulk-actions'
import type { PasteAnchor } from './hooks/use-board-clipboard'
import type { useBoardMutations } from './hooks/use-board-mutations'
import { useVisibleHourWindow } from './hooks/use-visible-hour-window'
import { type SlotClickTarget, SlotCreatePopover } from './slot-create-popover'
import type { BoardResourceInput, BoardViewMode, DispatchVisitEvent } from './types'
import { isPastVisitEvent } from './utils'
import { VisitChipContent, VisitChipMonthContent } from './visit-chip-content'
import { VisitPopoverContent } from './visit-popover'
import { WorkerColumnHeader } from './worker-column-header'

/** The board's right-click menu target (plan 37c §5.3) — resolved once per `contextmenu`
 * event from `e.target.closest('[data-event-id]')` (chips self-tag that attribute in
 * `draggable-event.tsx`/`agenda-view.tsx`); anything else is treated as empty-space. */
type BoardMenuTarget =
  | { type: 'chip'; visitId: string }
  | { type: 'slot'; slot: HoveredSlot | null; anchor: { x: number; y: number } }

interface BoardCalendarGridProps {
  date: Date
  onDateChange: (date: Date) => void
  view: BoardViewMode
  weekStartsOn: 0 | 1 | 6
  resources: BoardResourceInput[]
  backgroundEvents: BackgroundEvent[]
  events: DispatchVisitEvent[]
  overlappingIds: Set<string>
  canEdit: boolean
  mutations: ReturnType<typeof useBoardMutations>
  existingVisits: ExistingVisitForOverlap[]
  activeVisitId: string | null
  onActiveVisitChange: (visitId: string | null) => void
  /** Multi-selection (plan 37c §3) — the grid's ring rendering + gestures; independent of
   * `activeVisitId`, which stays the "which popover is open" concern. */
  selectedEventIds: string[]
  onSelectionChange: (ids: string[]) => void
  /** Plan 37c §5.2 — visit ids the bulk bar's runner currently has in flight; dims their
   * chips so a running bulk action reads as busy (the optimistic cache patches from
   * `use-board-mutations.ts` already give the instant settle, this is just the "still
   * working" affordance while the loop is mid-flight). */
  pendingVisitIds?: Set<string>
  onRangeChange: (from: Date, to: Date) => void
  onEventResize: (event: DispatchVisitEvent, newStart: Date, newEnd: Date) => void
  onOpenRecord: (recordId: RecordId, drill?: { panel?: string; item?: string }) => void
  isNonWorkingDay?: (date: Date) => boolean
  /** Plan 21 (dockable event panel) — sticky mode: while the event dock is open, every event
   * click routes to the panel instead of opening the floating `EventPopover`, so this suppresses
   * that popover entirely and renders a plain click target for the chip. */
  isDockOpen?: boolean
  /** Plan 37c §4/§5 — threaded straight into `EventCalendar`; `use-board-clipboard.ts` owns the
   * ref and reads it for the Cmd+V paste anchor. Also what the right-click menu's "Paste here"
   * snapshots at click time. */
  hoveredSlotRef?: React.MutableRefObject<HoveredSlot | null>
  /** Whether the clipboard has anything copied — disables "Paste here" in the context menu. */
  hasClipboard?: boolean
  /** Copies the given visit ids (`use-board-clipboard.ts`'s `copyIds`) — the grid decides WHICH
   * ids (selection-aware for the context menu's Copy item), the hook just writes the clipboard. */
  onCopyIds?: (ids: string[]) => void
  /** Opens the paste-options dialog anchored at the given target (`null` = fall back to the
   * board's current date, no time) — the context menu's "Paste here". */
  onPasteAt?: (target: PasteAnchor | null) => void
  /** Shared bulk actions (plan 44 §6) — the chip context menu's Assign/Dispatch/Backlog/Cancel run
   * through the SAME runner the bulk bar uses. Undefined on member (`!canEdit`) boards. */
  bulkActions?: BoardBulkActions
}

/**
 * The `EventCalendar` wiring itself (07 §D.2): day = `resources` mode, week/month = plain
 * views. Drag-move is handled by the ambient `CalendarDndProvider` the board mounts around
 * this component (and the backlog rail) — this component only supplies the read-only props
 * (`events`/`resources`/`backgroundEvents`/`renderEvent`) plus resize and click, which ARE
 * per-view props on `EventCalendar` itself.
 */
export function BoardCalendarGrid({
  date,
  onDateChange,
  view,
  weekStartsOn,
  resources,
  backgroundEvents,
  events,
  overlappingIds,
  canEdit,
  mutations,
  existingVisits,
  activeVisitId,
  onActiveVisitChange,
  selectedEventIds,
  onSelectionChange,
  pendingVisitIds,
  onRangeChange,
  onEventResize,
  onOpenRecord,
  isNonWorkingDay,
  isDockOpen,
  hoveredSlotRef,
  hasClipboard,
  onCopyIds,
  onPasteAt,
  bulkActions,
}: BoardCalendarGridProps) {
  const setEventDockOpen = useDispatchSidebarStore((s) => s.setEventDockOpen)
  // Docking transfers the currently controlled popover into the panel. Radix may report the
  // floating layer closing during that same commit; ignore that close so it cannot clear the
  // selected event and make the dock briefly reopen on its empty guide state.
  const dockingEventIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (isDockOpen) dockingEventIdRef.current = null
  }, [isDockOpen])

  const renderEvent = useCallback(
    (event: DispatchVisitEvent, ctx: RenderEventContext) => {
      const chipContent =
        ctx.view === 'month' ? (
          <VisitChipMonthContent event={event} />
        ) : (
          <VisitChipContent event={event} isOverlapping={overlappingIds.has(event.id)} />
        )
      // Bulk-runner pending-dim (plan 37c §5.2) — no interaction while a bulk action is
      // mid-flight for this visit; the optimistic cache patch handles the instant settle.
      const chip = pendingVisitIds?.has(event.id) ? (
        <div className='opacity-50 pointer-events-none'>{chipContent}</div>
      ) : (
        chipContent
      )

      // Sticky mode (plan 21 decision #3): docked, so route the click straight into the
      // panel — no floating popover, and no per-event popover state to manage here. Guarded
      // against modifier-clicks (plan 37c §3.2) — cmd/ctrl/shift-click manages the selection
      // only, via the grid's own gesture handling; it must not also flip the docked panel.
      if (isDockOpen) {
        return (
          <div
            className='h-full w-full'
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return
              onActiveVisitChange(event.id)
            }}>
            {chip}
          </div>
        )
      }

      const isOpen = activeVisitId === event.id
      return (
        <EventPopover
          open={isOpen}
          onOpenChange={(open) => {
            if (!open && dockingEventIdRef.current === event.id) return
            onActiveVisitChange(open ? event.id : null)
          }}
          series={{
            isMember: Boolean(event.recurrenceRuleId),
            // Plan 30 §D.2 — past-occurrence chooser collapse: "All visits" behaving identically
            // to "following" once the target's own window has passed is dishonest.
            labels: {
              this: 'This visit',
              following: isPastVisitEvent(event) ? 'Future visits' : 'This and following',
              all: 'All visits',
            },
            hideAll: isPastVisitEvent(event),
          }}
          anchor={<div className='h-full w-full'>{chip}</div>}>
          <VisitPopoverContent
            event={event}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            onClose={() => onActiveVisitChange(null)}
            onOpenRecord={onOpenRecord}
            onDock={() => {
              dockingEventIdRef.current = event.id
              onActiveVisitChange(event.id)
              setEventDockOpen(true)
            }}
          />
        </EventPopover>
      )
    },
    [
      activeVisitId,
      onActiveVisitChange,
      overlappingIds,
      pendingVisitIds,
      canEdit,
      mutations,
      existingVisits,
      onOpenRecord,
      isDockOpen,
      setEventDockOpen,
    ]
  )

  // Grid never calls this on a modifier-click (plan 37c §3.2) — behavior is unchanged from
  // before multi-selection, just carrying the mouse event through the new signature.
  const handleEventClick = useCallback(
    (event: DispatchVisitEvent, _e: React.MouseEvent) => onActiveVisitChange(event.id),
    [onActiveVisitChange]
  )

  // `day` maps onto the shared vertical resource day-stream (plan 18, `resourceDaysVisible=1`).
  // `timeline` is its own horizontal worker-rows-by-hour calendar view (plan 33) — it passes
  // through unchanged and no longer shares `resource`'s rendering.
  const calendarView = view === 'day' ? 'resource' : view

  // Plan 42 — hide empty off-day columns on week/timeline: org switch + the per-device reveal.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const hideEmptyOffDays = getSetting('dispatch.board.hideEmptyOffDays') === true
  const showAllDays = useTimelineViewStore((s) => s.showAllDays)

  // Days carrying at least one visit, memoized on a stable day-key digest (NOT the events-array
  // identity) so `isDayHidden`'s identity — and thus the shared day-stream's slot rebuild — only
  // churns when the actual booked-day set changes, not on every refetch/realtime patch (plan 42 §3).
  const visitDayDigest = useMemo(() => {
    const keys = new Set<string>()
    for (const event of events) keys.add(format(new Date(event.start), 'yyyy-MM-dd'))
    return Array.from(keys).sort().join(',')
  }, [events])
  const daysWithVisits = useMemo(
    () => new Set(visitDayDigest ? visitDayDigest.split(',') : []),
    [visitDayDigest]
  )

  // Hide a day only when it's off-work AND has zero visits — a booked off-day stays visible.
  const isEmptyOffDay = useCallback(
    (date: Date) => !!isNonWorkingDay?.(date) && !daysWithVisits.has(format(date, 'yyyy-MM-dd')),
    [isNonWorkingDay, daysWithVisits]
  )

  // Hiding engages on week/timeline/day when the org switch is on and the reveal is off (day is
  // a virtualized day STREAM too — scrolling/navigating just skips empty off-days; only month
  // keeps every cell). Otherwise pass `undefined` so the day-stream stays in pure IDENTITY mode —
  // no slot array built, no scroll re-anchor. Passing an always-false predicate instead would
  // materialize the full slot array and re-anchor on every event load during a scroll (the
  // "scroll resets position" bug).
  const hidingActive =
    hideEmptyOffDays && !showAllDays && (view === 'week' || view === 'timeline' || view === 'day')

  // Union the window with the loaded events' hours so a visit outside working hours (e.g. 1am)
  // still shows its row on every time-grid view — the crop never clips real work (plan 41).
  // "Show all days" is a full escape hatch: reveal every day AND widen hours to 0-24 (plan 42 §4).
  const computedWindow = useVisibleHourWindow(events)
  const hourWindow = useMemo(
    () => (showAllDays ? { start: 0, end: 24 } : computedWindow),
    [showAllDays, computedWindow]
  )

  // Per-device timeline zoom + rail width (plan 35) + lane height (plan 43) — persisted,
  // gesture commits write back.
  const timelineHourWidth = useTimelineViewStore((s) => s.hourWidth)
  const timelineRailWidth = useTimelineViewStore((s) => s.railWidth)
  const timelineLaneHeight = useTimelineViewStore((s) => s.laneHeight)
  const setTimelineHourWidth = useTimelineViewStore((s) => s.setHourWidth)
  const setTimelineRailWidth = useTimelineViewStore((s) => s.setRailWidth)
  const setTimelineLaneHeight = useTimelineViewStore((s) => s.setLaneHeight)
  // Vertical week/day grid zoom — same per-device persistence, committed by ctrl+wheel/pinch.
  const gridHourHeight = useTimelineViewStore((s) => s.gridHourHeight)
  const setGridHourHeight = useTimelineViewStore((s) => s.setGridHourHeight)

  const calendarResources: CalendarResource[] = useMemo(
    () =>
      resources.map((r) => ({
        id: r.id,
        label: r.label,
        header: r.worker ? (
          <WorkerColumnHeader name={r.label} image={r.worker.user?.image} color={r.color} />
        ) : (
          <span className='truncate text-muted-foreground text-sm'>{r.label}</span>
        ),
      })),
    [resources]
  )

  // Right-click menu (plan 37c §5.3) — spatial-target-only, the bulk bar owns everything
  // selection-targeted. Resolved once per `contextmenu` event, not re-derived on render.
  const [menuTarget, setMenuTarget] = useState<BoardMenuTarget | null>(null)

  // Slot create (plan 44) — the grid's `SlotCreateIntent` already carries the gesture's viewport
  // anchor (dblclick position / cmd+drag release point), so the old `onClickCapture` position
  // capture is gone; the popover anchors straight off `intent.anchor`.
  const [slotClickTarget, setSlotClickTarget] = useState<SlotClickTarget | null>(null)
  const handleSlotCreate = useCallback((intent: SlotCreateIntent) => {
    setSlotClickTarget({
      startTime: intent.start,
      endTime: intent.end,
      resourceId: intent.resourceId,
      anchor: intent.anchor,
    })
  }, [])

  // Ghost persist (decision C): while the create popover is open, echo its range back to the grid
  // so the translucent block stays over the slot; clearing the target removes it.
  const pendingCreateSlot = useMemo(
    () =>
      slotClickTarget
        ? {
            start: slotClickTarget.startTime,
            end: slotClickTarget.endTime,
            resourceId: slotClickTarget.resourceId,
          }
        : null,
    [slotClickTarget]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const chipEl = (e.target as HTMLElement).closest?.('[data-event-id]')
      const visitId = chipEl?.getAttribute('data-event-id')
      setMenuTarget(
        visitId
          ? { type: 'chip', visitId }
          : {
              type: 'slot',
              slot: hoveredSlotRef?.current ?? null,
              anchor: { x: e.clientX, y: e.clientY },
            }
      )
    },
    [hoveredSlotRef]
  )

  // Right-clicked chip inside the selection → the action targets the whole selection; outside →
  // the selection collapses to just it first (plan 44 §6, generalizing Copy's 37c §5.3 rule).
  const resolveMenuTargetIds = useCallback(
    (visitId: string): string[] => {
      if (selectedEventIds.includes(visitId)) return selectedEventIds
      onSelectionChange([visitId])
      return [visitId]
    },
    [selectedEventIds, onSelectionChange]
  )

  const handleCopyFromMenu = useCallback(() => {
    if (menuTarget?.type !== 'chip') return
    onCopyIds?.(resolveMenuTargetIds(menuTarget.visitId))
  }, [menuTarget, resolveMenuTargetIds, onCopyIds])

  const handleAssignFromMenu = useCallback(
    (assigneeUserId: string | null) => {
      if (menuTarget?.type !== 'chip') return
      bulkActions?.assign(resolveMenuTargetIds(menuTarget.visitId), assigneeUserId)
    },
    [menuTarget, resolveMenuTargetIds, bulkActions]
  )

  const handleDispatchFromMenu = useCallback(() => {
    if (menuTarget?.type !== 'chip') return
    bulkActions?.dispatch(resolveMenuTargetIds(menuTarget.visitId))
  }, [menuTarget, resolveMenuTargetIds, bulkActions])

  const handleBacklogFromMenu = useCallback(() => {
    if (menuTarget?.type !== 'chip') return
    bulkActions?.moveToBacklog(resolveMenuTargetIds(menuTarget.visitId))
  }, [menuTarget, resolveMenuTargetIds, bulkActions])

  const handleCancelFromMenu = useCallback(() => {
    if (menuTarget?.type !== 'chip') return
    bulkActions?.cancel(resolveMenuTargetIds(menuTarget.visitId))
  }, [menuTarget, resolveMenuTargetIds, bulkActions])

  const handlePasteFromMenu = useCallback(() => {
    if (menuTarget?.type !== 'slot') return
    const { slot } = menuTarget
    onPasteAt?.(slot ? { day: slot.date, time: slot.time, resourceId: slot.resourceId } : null)
  }, [menuTarget, onPasteAt])

  // "New event here" (plan 44 §5) — open the same slot-create popover from the right-clicked slot:
  // its hovered day/time (rounded to the quarter; month → `DefaultStartHour`) + worker, anchored at
  // the right-click coords.
  const handleNewEventHere = useCallback(() => {
    if (menuTarget?.type !== 'slot') return
    const { slot, anchor } = menuTarget
    const startTime = new Date(slot?.date ?? date)
    if (slot?.time !== undefined) {
      const hours = Math.floor(slot.time)
      const minutes = Math.round((slot.time - hours) * 60)
      startTime.setHours(hours, minutes, 0, 0)
    } else {
      startTime.setHours(DefaultStartHour, 0, 0, 0)
    }
    setSlotClickTarget({
      startTime,
      endTime: addMinutes(startTime, 60),
      resourceId: slot?.resourceId,
      anchor,
    })
  }, [menuTarget, date])

  const calendar = (
    <EventCalendar<DispatchVisitEvent>
      date={date}
      view={calendarView}
      onDateChange={onDateChange}
      onViewChange={() => {}}
      onRangeChange={onRangeChange}
      weekStartsOn={weekStartsOn}
      resources={view === 'day' || view === 'timeline' ? calendarResources : undefined}
      hourWindow={hourWindow}
      timelineHourWidth={timelineHourWidth}
      onTimelineHourWidthChange={setTimelineHourWidth}
      timelineRailWidth={timelineRailWidth}
      onTimelineRailWidthChange={setTimelineRailWidth}
      timelineLaneHeight={timelineLaneHeight}
      onTimelineLaneHeightChange={setTimelineLaneHeight}
      gridHourHeight={gridHourHeight}
      onGridHourHeightChange={setGridHourHeight}
      backgroundEvents={backgroundEvents}
      events={events}
      renderEvent={renderEvent}
      selectedEventIds={selectedEventIds}
      onSelectionChange={onSelectionChange}
      onEventClick={handleEventClick}
      onEventResize={canEdit && view !== 'month' ? onEventResize : undefined}
      onSlotCreate={canEdit ? handleSlotCreate : undefined}
      pendingCreateSlot={pendingCreateSlot}
      hideToolbar
      isNonWorkingDay={isNonWorkingDay}
      // Month never hides day cells — week/timeline/day drop (skip) empty off-days.
      isDayHidden={hidingActive ? isEmptyOffDay : undefined}
      hoveredSlotRef={hoveredSlotRef}
      className='flex-1'
    />
  )

  // Copy/paste's right-click affordance is admin-gated like every other write path (plan 37c
  // derived decision) — members get the plain calendar, no `ContextMenu` wrapper at all.
  if (!canEdit) return calendar

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setMenuTarget(null)
        }}>
        {/* `display: contents` keeps this wrapper out of the flex layout — `EventCalendar`'s own
         * root (className='flex-1' above) still lands as the direct flex child its parent row
         * (`dispatch-board.tsx`'s `flex flex-1 overflow-hidden`) expects. */}
        <ContextMenuTrigger asChild>
          <div className='contents' onContextMenu={handleContextMenu}>
            {calendar}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className='w-52'>
          {menuTarget?.type === 'chip' ? (
            <>
              <ContextMenuItem onSelect={handleCopyFromMenu}>
                <Copy /> Copy
                <ContextMenuShortcut>⌘C</ContextMenuShortcut>
              </ContextMenuItem>
              <BoardAssignContextSubmenu onSelect={handleAssignFromMenu} />
              <ContextMenuItem onSelect={handleDispatchFromMenu}>
                <Send /> Dispatch
              </ContextMenuItem>
              <ContextMenuItem onSelect={handleBacklogFromMenu}>
                <Inbox /> Move to backlog
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant='destructive' onSelect={handleCancelFromMenu}>
                <Ban /> Cancel
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={handleNewEventHere}>
                <CalendarPlus /> New event here
              </ContextMenuItem>
              <ContextMenuItem disabled={!hasClipboard} onSelect={handlePasteFromMenu}>
                <ClipboardPaste /> Paste here
                <ContextMenuShortcut>⌘V</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <SlotCreatePopover
        target={slotClickTarget}
        onOpenChange={(open) => {
          if (!open) setSlotClickTarget(null)
        }}
        onSelectionChange={onSelectionChange}
        mutations={mutations}
      />
    </>
  )
}

// apps/web/src/components/dispatch/ui/board/board-calendar-grid.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  type BackgroundEvent,
  type CalendarResource,
  EventCalendar,
  EventPopover,
  type RenderEventContext,
} from '@auxx/ui/components/event-calendar'
import { useCallback, useMemo } from 'react'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { BoardResourceInput, BoardViewMode, DispatchVisitEvent } from './types'
import { VisitChipContent, VisitChipMonthContent } from './visit-chip-content'
import { VisitPopoverContent } from './visit-popover'
import { WorkerColumnHeader } from './worker-column-header'

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
  onRangeChange: (from: Date, to: Date) => void
  onEventResize: (event: DispatchVisitEvent, newEnd: Date) => void
  onOpenRecord: (recordId: RecordId, drill?: { panel?: string; item?: string }) => void
  isNonWorkingDay?: (date: Date) => boolean
  /** Plan 21 (dockable event panel) — sticky mode: while the event dock is open, every event
   * click routes to the panel instead of opening the floating `EventPopover`, so this suppresses
   * that popover entirely and renders a plain click target for the chip. */
  isDockOpen?: boolean
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
  onRangeChange,
  onEventResize,
  onOpenRecord,
  isNonWorkingDay,
  isDockOpen,
}: BoardCalendarGridProps) {
  const setEventDockOpen = useDispatchSidebarStore((s) => s.setEventDockOpen)

  const renderEvent = useCallback(
    (event: DispatchVisitEvent, ctx: RenderEventContext) => {
      const chip =
        ctx.view === 'month' ? (
          <VisitChipMonthContent event={event} />
        ) : (
          <VisitChipContent event={event} isOverlapping={overlappingIds.has(event.id)} />
        )

      // Sticky mode (plan 21 decision #3): docked, so route the click straight into the
      // panel — no floating popover, and no per-event popover state to manage here.
      if (isDockOpen) {
        return (
          <div className='h-full w-full' onClick={() => onActiveVisitChange(event.id)}>
            {chip}
          </div>
        )
      }

      const isOpen = activeVisitId === event.id
      return (
        <EventPopover
          open={isOpen}
          onOpenChange={(open) => onActiveVisitChange(open ? event.id : null)}
          series={{
            isMember: Boolean(event.recurrenceRuleId),
            labels: { this: 'This visit', following: 'This and following', all: 'All visits' },
          }}
          anchor={<div className='h-full w-full'>{chip}</div>}>
          <VisitPopoverContent
            event={event}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            onClose={() => onActiveVisitChange(null)}
            onOpenRecord={onOpenRecord}
            onDock={() => setEventDockOpen(true)}
          />
        </EventPopover>
      )
    },
    [
      activeVisitId,
      onActiveVisitChange,
      overlappingIds,
      canEdit,
      mutations,
      existingVisits,
      onOpenRecord,
      isDockOpen,
      setEventDockOpen,
    ]
  )

  const handleEventClick = useCallback(
    (event: DispatchVisitEvent) => onActiveVisitChange(event.id),
    [onActiveVisitChange]
  )

  // Both `day` and `timeline` render the same resource day-stream (plan 18); they differ only by
  // `resourceDaysVisible` (1 vs 3), passed to `EventCalendar` below.
  const calendarView = view === 'day' || view === 'timeline' ? 'resource' : view

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

  return (
    <EventCalendar<DispatchVisitEvent>
      date={date}
      view={calendarView}
      onDateChange={onDateChange}
      onViewChange={() => {}}
      onRangeChange={onRangeChange}
      weekStartsOn={weekStartsOn}
      resources={view === 'day' || view === 'timeline' ? calendarResources : undefined}
      resourceDaysVisible={view === 'timeline' ? 3 : 1}
      backgroundEvents={backgroundEvents}
      events={events}
      renderEvent={renderEvent}
      selectedEventId={activeVisitId}
      onEventClick={handleEventClick}
      onEventResize={canEdit && view !== 'month' ? onEventResize : undefined}
      hideToolbar
      isNonWorkingDay={isNonWorkingDay}
      className='flex-1'
    />
  )
}

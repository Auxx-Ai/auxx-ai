// apps/web/src/components/dispatch/ui/board/board-calendar-grid.tsx

'use client'

import {
  type BackgroundEvent,
  type CalendarResource,
  EventCalendar,
  EventPopover,
  type RenderEventContext,
} from '@auxx/ui/components/event-calendar'
import { useCallback, useMemo } from 'react'
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
  isNonWorkingDay?: (date: Date) => boolean
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
  isNonWorkingDay,
}: BoardCalendarGridProps) {
  const renderEvent = useCallback(
    (event: DispatchVisitEvent, ctx: RenderEventContext) => {
      const isOpen = activeVisitId === event.id
      return (
        <EventPopover
          open={isOpen}
          onOpenChange={(open) => onActiveVisitChange(open ? event.id : null)}
          series={{
            isMember: Boolean(event.recurrenceRuleId),
            labels: { this: 'This visit', following: 'This and following', all: 'All visits' },
          }}
          anchor={
            <div className='h-full w-full'>
              {ctx.view === 'month' ? (
                <VisitChipMonthContent event={event} />
              ) : (
                <VisitChipContent event={event} isOverlapping={overlappingIds.has(event.id)} />
              )}
            </div>
          }>
          <VisitPopoverContent
            event={event}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            onClose={() => onActiveVisitChange(null)}
          />
        </EventPopover>
      )
    },
    [activeVisitId, onActiveVisitChange, overlappingIds, canEdit, mutations, existingVisits]
  )

  const handleEventClick = useCallback(
    (event: DispatchVisitEvent) => onActiveVisitChange(event.id),
    [onActiveVisitChange]
  )

  const calendarView = view === 'day' ? 'resource' : view

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
      resources={view === 'day' ? calendarResources : undefined}
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

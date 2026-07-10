// apps/web/src/components/dispatch/ui/board/board-calendar-grid.tsx

'use client'

import {
  type BackgroundEvent,
  type CalendarResource,
  EventCalendar,
} from '@auxx/ui/components/event-calendar'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { useCallback, useMemo } from 'react'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import type { useBoardMutations } from './hooks/use-board-mutations'
import type { BoardResourceInput, BoardViewMode, DispatchVisitEvent } from './types'
import { VisitActionsPopoverContent } from './visit-actions-popover'
import { VisitChipContent } from './visit-chip-content'
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
}: BoardCalendarGridProps) {
  const renderEvent = useCallback(
    (event: DispatchVisitEvent) => {
      const isOpen = activeVisitId === event.id
      return (
        <Popover open={isOpen} onOpenChange={(open) => onActiveVisitChange(open ? event.id : null)}>
          <PopoverAnchor asChild>
            <div className='h-full w-full'>
              <VisitChipContent event={event} isOverlapping={overlappingIds.has(event.id)} />
            </div>
          </PopoverAnchor>
          <PopoverContent
            side='right'
            align='start'
            className='w-auto p-0'
            onOpenAutoFocus={(e) => e.preventDefault()}>
            <VisitActionsPopoverContent
              event={event}
              canEdit={canEdit}
              mutations={mutations}
              existingVisits={existingVisits}
              onClose={() => onActiveVisitChange(null)}
            />
          </PopoverContent>
        </Popover>
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
      onEventClick={handleEventClick}
      onEventResize={canEdit && view !== 'month' ? onEventResize : undefined}
      hideToolbar
      className='flex-1'
    />
  )
}

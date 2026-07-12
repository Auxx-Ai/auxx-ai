// apps/web/src/components/dispatch/ui/route-planner/backlog-pane.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import { MapPin } from 'lucide-react'
import { useMemo } from 'react'
import type { PlannerBacklogVisit, PlannerBoard, PlannerFilters, PlannerVisit } from './types'

/** Not a named seam export (types.ts only exports the shapes listed in the build contract) —
 * derived via indexed access so this file doesn't guess at a type name 2A didn't declare. */
type PlannerWorkOrder = PlannerBoard['workOrders'][number]

interface BacklogPaneProps {
  board: PlannerBoard
  filters: PlannerFilters
  onFocusVisit: (visitId: string) => void
}

/** A visit's work order shares at least one of the selected tags (`null` selection = all). */
function matchesTagFilter(
  workOrder: PlannerWorkOrder | undefined,
  tags: Set<string> | null
): boolean {
  if (tags === null) return true
  if (!workOrder) return false
  return workOrder.tags.some((t) => tags.has(t))
}

/**
 * Route planner left pane (design doc §E, seam contract's `BacklogPane`): two labeled groups —
 * unscheduled work (`board.backlog`, `startTime: null`) and today's unassigned visits
 * (`board.visits` with `assigneeUserId: null`, matching the board's own "Unassigned" column
 * semantics). Both tag-filtered. Rows are `useDraggable` sources for the planner's own
 * `DndContext` (2A's `route-planner-view.tsx`) — the slot-in gesture reads
 * `active.data.current` in `use-route-planner-mutations.ts`'s `useRoutePlannerDragEnd`.
 */
export function BacklogPane({ board, filters, onFocusVisit }: BacklogPaneProps) {
  const workOrderById = useMemo(
    () => new Map(board.workOrders.map((w) => [w.id, w])),
    [board.workOrders]
  )

  const unscheduled = useMemo(
    () =>
      board.backlog.filter((v) => matchesTagFilter(workOrderById.get(v.workOrderId), filters.tags)),
    [board.backlog, workOrderById, filters.tags]
  )
  const unassignedToday = useMemo(
    () =>
      board.visits.filter(
        (v) =>
          v.assigneeUserId === null &&
          v.status !== 'canceled' &&
          matchesTagFilter(workOrderById.get(v.workOrderId), filters.tags)
      ),
    [board.visits, workOrderById, filters.tags]
  )

  return (
    <div className='flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r p-2'>
      <BacklogGroup
        title='Unscheduled'
        visits={unscheduled}
        workOrderById={workOrderById}
        onFocusVisit={onFocusVisit}
      />
      <BacklogGroup
        title='Unassigned today'
        visits={unassignedToday}
        workOrderById={workOrderById}
        onFocusVisit={onFocusVisit}
      />
    </div>
  )
}

interface BacklogGroupProps {
  title: string
  visits: (PlannerBacklogVisit | PlannerVisit)[]
  workOrderById: Map<string, PlannerWorkOrder>
  onFocusVisit: (visitId: string) => void
}

function BacklogGroup({ title, visits, workOrderById, onFocusVisit }: BacklogGroupProps) {
  return (
    <div>
      <div className='text-muted-foreground px-1 pb-1 text-xs font-medium'>
        {title} ({visits.length})
      </div>
      {visits.length === 0 ? (
        <div className='text-muted-foreground px-1 text-xs'>Nothing here.</div>
      ) : (
        <div className='flex flex-col gap-1'>
          {visits.map((visit) => (
            <BacklogRow
              key={visit.id}
              visit={visit}
              workOrder={workOrderById.get(visit.workOrderId)}
              onFocusVisit={onFocusVisit}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface BacklogRowProps {
  visit: PlannerBacklogVisit | PlannerVisit
  workOrder: PlannerWorkOrder | undefined
  onFocusVisit: (visitId: string) => void
}

function BacklogRow({ visit, workOrder, onFocusVisit }: BacklogRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `planner-backlog-${visit.id}`,
    data: { type: 'planner-backlog', visitId: visit.id },
  })
  const isGeocoded = visit.latitude !== null && visit.longitude !== null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => isGeocoded && onFocusVisit(visit.id)}
      className={cn(
        'bg-card cursor-grab touch-none rounded-md border p-2 text-xs active:cursor-grabbing',
        isGeocoded && 'hover:border-primary-300',
        isDragging && 'opacity-40'
      )}>
      <div className='truncate font-medium'>
        {workOrder?.number ? `${workOrder.number} · ` : ''}
        {workOrder?.displayName ?? 'Work order'}
      </div>
      {workOrder?.contactDisplayName && (
        <div className='text-muted-foreground truncate'>{workOrder.contactDisplayName}</div>
      )}
      {workOrder?.addressText ? (
        <div className='text-muted-foreground mt-0.5 flex items-center gap-1 truncate'>
          <MapPin className='size-3 shrink-0' />
          {workOrder.addressText}
        </div>
      ) : null}
      {!isGeocoded && (
        <Badge variant='secondary' className='mt-1'>
          No address
        </Badge>
      )}
    </div>
  )
}

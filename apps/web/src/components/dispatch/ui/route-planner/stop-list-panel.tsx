// apps/web/src/components/dispatch/ui/route-planner/stop-list-panel.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import { GripVertical, Route, Timer } from 'lucide-react'
import { useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import { ApplyTimesDialog } from './apply-times-dialog'
import {
  dayStartAnchor,
  estimateArrivalForVisit,
  stopsForWorker,
  useRoutePlannerMutations,
} from './hooks/use-route-planner-mutations'
import { suggestRouteOrder } from './suggest-order'
import type {
  PlannerBoard,
  PlannerDayWindow,
  PlannerFilters,
  PlannerVisit,
  PlannerWorker,
  RouteGeometry,
} from './types'

type PlannerWorkOrder = PlannerBoard['workOrders'][number]

interface StopListPanelProps {
  board: PlannerBoard
  filters: PlannerFilters
  geometryByWorker: Record<string, RouteGeometry | undefined>
  date: PlannerDayWindow
}

/**
 * Route planner right pane (design doc §E, seam contract's `StopListPanel`): one collapsible
 * section per visible worker, each a `@dnd-kit/sortable` `SortableContext` over that worker's
 * day stops (`routeOrder` asc, nulls last). Drag-reorder within a section writes `setRouteOrder`
 * optimistically; dragging a row (or a backlog-pane row) between sections is handled by
 * `useRoutePlannerDragEnd` (`hooks/use-route-planner-mutations.ts`) — this component only
 * registers the draggable/droppable ids that hook reads, it never calls the mutations directly
 * for cross-list moves.
 */
export function StopListPanel({ board, filters, geometryByWorker, date }: StopListPanelProps) {
  const visibleWorkers =
    filters.workerIds === null
      ? board.workers
      : board.workers.filter((w) => filters.workerIds!.has(w.userId))

  const workOrderById = new Map(board.workOrders.map((w) => [w.id, w]))

  return (
    <div className='flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l p-2'>
      {visibleWorkers.map((worker) => (
        <WorkerStopSection
          key={worker.id}
          worker={worker}
          board={board}
          date={date}
          geometry={geometryByWorker[worker.userId]}
          workOrderById={workOrderById}
        />
      ))}
    </div>
  )
}

interface WorkerStopSectionProps {
  worker: PlannerWorker
  board: PlannerBoard
  date: PlannerDayWindow
  geometry: RouteGeometry | undefined
  workOrderById: Map<string, PlannerWorkOrder>
}

function WorkerStopSection({
  worker,
  board,
  date,
  geometry,
  workOrderById,
}: WorkerStopSectionProps) {
  const [open, setOpen] = useState(true)
  const [applyOpen, setApplyOpen] = useState(false)
  const { setRouteOrder } = useRoutePlannerMutations(date)
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `planner-worker-list-${worker.userId}`,
    data: { type: 'planner-worker-list', assigneeUserId: worker.userId },
  })

  const stops = stopsForWorker(board, worker.userId)
  const activeStops = stops.filter((v) => v.status !== 'done')
  const dayStart = dayStartAnchor(date, worker, '08:00')

  const handleSuggest = () => {
    const movable = stops.filter((v) => v.status !== 'done')
    const done = stops.filter((v) => v.status === 'done')
    const suggested = suggestRouteOrder(
      geometry?.depot ?? null,
      movable.map((v) => ({ visitId: v.id, lat: v.latitude, lng: v.longitude }))
    )
    // Done stops already happened — keep them out of the heuristic and append them so their
    // `routeOrder` isn't nulled by the bulk write (contract item 4 nulls anything NOT in the list).
    setRouteOrder.mutate(
      {
        assigneeUserId: worker.userId,
        from: date.from,
        to: date.to,
        visitIds: [...suggested, ...done.map((v) => v.id)],
      },
      {
        onError: (error) =>
          toastError({ title: 'Error suggesting route', description: error.message }),
      }
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='rounded-md border'>
      <div className='flex items-center gap-2 p-2'>
        <CollapsibleTrigger asChild>
          <button type='button' className='flex flex-1 items-center gap-2 text-left'>
            <CollapsibleChevron open={open} />
            <Avatar className='size-5'>
              <AvatarImage src={worker.image ?? undefined} />
              <AvatarFallback className='text-[9px]'>
                {getInitials(worker.name ?? worker.email ?? 'Worker')}
              </AvatarFallback>
            </Avatar>
            <span className='truncate text-sm font-medium'>{worker.name ?? worker.email}</span>
            <span className='text-muted-foreground text-xs'>({stops.length})</span>
          </button>
        </CollapsibleTrigger>
        <Button variant='ghost' size='icon-xs' title='Suggest route' onClick={handleSuggest}>
          <Route />
        </Button>
        <Button variant='outline' size='sm' onClick={() => setApplyOpen(true)}>
          <Timer /> Apply times
        </Button>
      </div>

      <CollapsibleContent>
        <div ref={setDroppableRef} className='space-y-1 border-t p-2'>
          {stops.length === 0 ? (
            <div className='text-muted-foreground px-1 py-2 text-xs'>No stops today.</div>
          ) : (
            <SortableContext items={stops.map((v) => v.id)} strategy={verticalListSortingStrategy}>
              {stops.map((visit, index) => (
                <StopRow
                  key={visit.id}
                  visit={visit}
                  index={index}
                  assigneeUserId={worker.userId}
                  workOrder={workOrderById.get(visit.workOrderId)}
                  eta={estimateArrivalForVisit(dayStart, geometry, visit.id)}
                />
              ))}
            </SortableContext>
          )}
        </div>
      </CollapsibleContent>

      <ApplyTimesDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        worker={worker}
        stops={activeStops}
        geometry={geometry}
        date={date}
      />
    </Collapsible>
  )
}

interface StopRowProps {
  visit: PlannerVisit
  index: number
  assigneeUserId: string
  workOrder: PlannerWorkOrder | undefined
  eta: Date | null
}

function StopRow({ visit, index, assigneeUserId, workOrder, eta }: StopRowProps) {
  const isDone = visit.status === 'done'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: visit.id,
    data: { type: 'planner-stop', visitId: visit.id, assigneeUserId },
    disabled: isDone,
  })

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-card p-2 text-xs',
        isDone && 'opacity-50',
        isDragging && 'opacity-40'
      )}>
      {!isDone && (
        <div
          {...attributes}
          {...listeners}
          className='cursor-grab touch-none active:cursor-grabbing'>
          <GripVertical className='text-muted-foreground size-3' />
        </div>
      )}
      <Badge variant='secondary' className='shrink-0'>
        {index + 1}
      </Badge>
      <div className='min-w-0 flex-1'>
        <div className='truncate font-medium'>
          {workOrder?.number ? `${workOrder.number} · ` : ''}
          {workOrder?.displayName ?? 'Work order'}
        </div>
      </div>
      {eta && <span className='text-muted-foreground shrink-0'>~{format(eta, 'p')}</span>}
    </div>
  )
}

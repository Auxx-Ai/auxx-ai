// apps/web/src/components/dispatch/ui/sidebar/routes-group.tsx

'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import { SidebarGroup, SidebarGroupCollapse } from '@auxx/ui/components/sidebar'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import { GripVertical, Route as RouteIcon, Timer } from 'lucide-react'
import { useState } from 'react'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { getInitials } from '~/components/groups/utils/group-utils'
import { ApplyTimesDialog } from '../route-planner/apply-times-dialog'
import {
  dayStartAnchor,
  estimateArrivalForVisit,
  stopsForWorker,
  useRoutePlannerMutations,
} from '../route-planner/hooks/use-route-planner-mutations'
import { suggestRouteOrder } from '../route-planner/suggest-order'
import type {
  PlannerBoard,
  PlannerDayWindow,
  PlannerFilters,
  PlannerVisit,
  PlannerWorker,
  RouteGeometry,
} from '../route-planner/types'

type PlannerWorkOrder = PlannerBoard['workOrders'][number]

interface RoutesGroupProps {
  board: PlannerBoard
  filters: PlannerFilters
  geometryByWorker: Record<string, RouteGeometry | undefined>
  date: PlannerDayWindow
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Per-worker sub-section open state, keyed `routes:<userId>` in the same store map as the
   * group itself (`groupOpen`) — persisted so a dispatcher's per-worker collapse choices stick. */
  groupOpen: Record<string, boolean>
  onWorkerOpenChange: (userId: string, open: boolean) => void
}

/**
 * Sidebar Routes group (v3 sidebar plan §1.2, map mode only) — ported nearly verbatim from the
 * deleted `route-planner/stop-list-panel.tsx`'s `WorkerStopSection`/`StopRow`: same
 * `useDroppable`/`SortableContext` wiring (`useRoutePlannerDragEnd` still owns cross-list
 * drops), same Suggest (`suggestRouteOrder` → `setRouteOrder`) and Apply-times
 * (`ApplyTimesDialog`) actions — only the visual shell changes (sidebar one-line rows instead of
 * a drawer's cards) and per-worker collapse now persists via the sidebar store instead of local
 * `useState`.
 */
export function RoutesGroup({
  board,
  filters,
  geometryByWorker,
  date,
  open,
  onOpenChange,
  groupOpen,
  onWorkerOpenChange,
}: RoutesGroupProps) {
  const visibleWorkers =
    filters.workerIds === null
      ? board.workers
      : board.workers.filter((w) => filters.workerIds!.has(w.userId))

  const workOrderById = new Map(board.workOrders.map((w) => [w.id, w]))

  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title='Routes'
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
      />
      <SidebarGroupCollapse open={open}>
        <div className='flex flex-col gap-1.5 px-0.5'>
          {visibleWorkers.map((worker) => (
            <WorkerStopSection
              key={worker.id}
              worker={worker}
              board={board}
              date={date}
              geometry={geometryByWorker[worker.userId]}
              workOrderById={workOrderById}
              open={groupOpen[`routes:${worker.userId}`] ?? true}
              onOpenChange={(o) => onWorkerOpenChange(worker.userId, o)}
            />
          ))}
        </div>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}

interface WorkerStopSectionProps {
  worker: PlannerWorker
  board: PlannerBoard
  date: PlannerDayWindow
  geometry: RouteGeometry | undefined
  workOrderById: Map<string, PlannerWorkOrder>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function WorkerStopSection({
  worker,
  board,
  date,
  geometry,
  workOrderById,
  open,
  onOpenChange,
}: WorkerStopSectionProps) {
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
    <div className='rounded-md border'>
      <div className='flex items-center gap-1 p-1.5'>
        <button
          type='button'
          className='flex flex-1 items-center gap-1.5 text-left'
          onClick={() => onOpenChange(!open)}>
          <CollapsibleChevron open={open} />
          <Avatar className='size-5'>
            <AvatarImage src={worker.image ?? undefined} />
            <AvatarFallback className='text-[9px]'>
              {getInitials(worker.name ?? worker.email ?? 'Worker')}
            </AvatarFallback>
          </Avatar>
          <span className='truncate text-xs font-medium'>{worker.name ?? worker.email}</span>
          <span className='text-muted-foreground text-xs'>({stops.length})</span>
        </button>
        <Button variant='ghost' size='icon-xs' title='Suggest route' onClick={handleSuggest}>
          <RouteIcon />
        </Button>
        <Button
          variant='ghost'
          size='icon-xs'
          title='Apply times'
          onClick={() => setApplyOpen(true)}>
          <Timer />
        </Button>
      </div>

      <SidebarGroupCollapse open={open}>
        <div ref={setDroppableRef} className='space-y-1 border-t p-1.5'>
          {stops.length === 0 ? (
            <div className='text-muted-foreground px-1 py-1 text-xs'>No stops today.</div>
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
      </SidebarGroupCollapse>

      <ApplyTimesDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        worker={worker}
        stops={activeStops}
        geometry={geometry}
        date={date}
      />
    </div>
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
        'hover:bg-sidebar-accent flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs',
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
      <span className='text-muted-foreground shrink-0 tabular-nums'>{index + 1}.</span>
      <span className='min-w-0 flex-1 truncate'>{workOrder?.number ?? 'Work order'}</span>
      {eta && <span className='text-muted-foreground shrink-0'>· {format(eta, 'p')}</span>}
    </div>
  )
}

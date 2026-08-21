// apps/web/src/components/dispatch/ui/sidebar/routes-group.tsx

'use client'

import { getOptionColor } from '@auxx/lib/custom-fields/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { CollapsibleChevron } from '@auxx/ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@auxx/ui/components/sidebar'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import { AlertTriangle, MoreVertical, Route as RouteIcon, Timer, X } from 'lucide-react'
import { useState } from 'react'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { Tooltip } from '~/components/global/tooltip'
import { useSettings } from '~/hooks/use-settings'
import { ApplyTimesDialog } from '../route-planner/apply-times-dialog'
import {
  dayStartAnchor,
  estimateArrivalForVisit,
  routeTimesDrift,
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
  canEdit: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Per-worker sub-section open state, keyed `routes:<workerId>` (a `DispatchWorker.id`) in the
   * same store map as the group itself (`groupOpen`) — persisted so a dispatcher's per-worker
   * collapse choices stick. */
  groupOpen: Record<string, boolean>
  onWorkerOpenChange: (workerId: string, open: boolean) => void
  /** Stop row click (v4/02 Phase 3) — reports the row's work-order instance id AND visit id so
   * the board shell can open a `RecordDrawer` pre-drilled to the visit (same wiring as the
   * Backlog group's rows). */
  onSelectVisit?: (sel: { workOrderId: string; visitId: string }) => void
}

/**
 * Sidebar Routes group (v3 sidebar plan §1.2, map mode only) — one folder-style row per worker
 * (color dot + name + stop count + hover 3-dot menu with Suggest route / Apply times, patterned
 * on `entity-folder.tsx`) collapsing into `SidebarMenuSub` stop rows. Stop rows are whole-row
 * draggable `useSortable`s (`useRoutePlannerDragEnd` still owns reorders and cross-list drops;
 * the shared `AppDragOverlay` renders the cursor ghost), click through to the record drawer via
 * `onSelectVisit`, and carry a hover X that unassigns the visit back to the backlog.
 */
export function RoutesGroup({
  board,
  filters,
  geometryByWorker,
  date,
  canEdit,
  open,
  onOpenChange,
  groupOpen,
  onWorkerOpenChange,
  onSelectVisit,
}: RoutesGroupProps) {
  const visibleWorkers =
    filters.workerIds === null
      ? board.workers
      : board.workers.filter((w) => filters.workerIds!.has(w.id))

  const workOrderById = new Map(board.workOrders.map((w) => [w.id, w]))

  // Read once here (not per-worker) — plan 20 §5's tooltip copy for the drift badge depends on
  // whether auto-sync is on org-wide; every `WorkerStopSection` shares the same read.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const autoApplyTimes = !!getSetting('dispatch.routes.autoApplyTimes')

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
        <SidebarMenu>
          {visibleWorkers.map((worker) => (
            <WorkerStopSection
              key={worker.id}
              worker={worker}
              board={board}
              date={date}
              geometry={geometryByWorker[worker.id]}
              workOrderById={workOrderById}
              canEdit={canEdit}
              autoApplyTimes={autoApplyTimes}
              open={groupOpen[`routes:${worker.id}`] ?? true}
              onOpenChange={(o) => onWorkerOpenChange(worker.id, o)}
              onSelectVisit={onSelectVisit}
            />
          ))}
        </SidebarMenu>
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
  canEdit: boolean
  /** `dispatch.routes.autoApplyTimes` org setting (plan 20 §5) — changes the drift badge's
   * tooltip copy when 'drifted': with auto-sync on, drift only ever means a confirmed-stop
   * conflict, not a stale unapplied reorder. */
  autoApplyTimes: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectVisit?: (sel: { workOrderId: string; visitId: string }) => void
}

function WorkerStopSection({
  worker,
  board,
  date,
  geometry,
  workOrderById,
  canEdit,
  autoApplyTimes,
  open,
  onOpenChange,
  onSelectVisit,
}: WorkerStopSectionProps) {
  const [applyOpen, setApplyOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { setRouteOrder, assignVisit } = useRoutePlannerMutations(date)
  const { active } = useDndContext()
  const isCompatibleDrag =
    active?.data.current?.type === 'planner-backlog' ||
    active?.data.current?.type === 'planner-stop'
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `planner-worker-list-${worker.id}`,
    data: { type: 'planner-worker-list', assigneeWorkerId: worker.id },
  })

  const stops = stopsForWorker(board, worker.id)
  const activeStops = stops.filter((v) => v.status !== 'done')
  const dayStart = dayStartAnchor(date, worker, '08:00')
  const workerName = worker.name ?? worker.email ?? 'Worker'

  // Drift badge (plan 20 §3.2): 'unapplied' with zero stops is a no-op empty section, not
  // something worth flagging.
  const drift = routeTimesDrift(stops)
  const showDriftDot = drift === 'drifted' || (drift === 'unapplied' && stops.length > 0)

  const handleSuggest = () => {
    const movable = stops.filter((v) => v.status !== 'done')
    const done = stops.filter((v) => v.status === 'done')
    // `board.depot` (the org's own business-address geocode) is always present when the board
    // query loaded at all; `geometry.depot` is a per-worker route-start point gated by
    // `routeStartAtHome` and only exists once geometry has loaded (plan 20 §6 wart).
    const suggested = suggestRouteOrder(
      board.depot ?? null,
      movable.map((v) => ({ visitId: v.id, lat: v.latitude, lng: v.longitude }))
    )
    // Done stops already happened — keep them out of the heuristic and append them so their
    // `routeOrder` isn't nulled by the bulk write (contract item 4 nulls anything NOT in the list).
    setRouteOrder.mutate(
      {
        assigneeWorkerId: worker.id,
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
    // The whole section (header row + stop list) is ONE drop target — a drag can land on the
    // worker even while their stop list is collapsed. Inset ring/outline (entity-folder.tsx's
    // recipe): the sidebar clips overflow, so non-inset variants get cut off at the edges.
    <SidebarMenuItem
      ref={setDroppableRef}
      className={cn(
        'rounded-md transition-colors duration-150 ease-in-out',
        isCompatibleDrag && 'outline-dashed outline-1 outline-primary/30 [outline-offset:-1px]',
        isCompatibleDrag &&
          isOver &&
          'bg-primary/20 outline-primary/80 ring-2 ring-inset ring-primary/60'
      )}>
      <SidebarMenuButton asChild className='h-7 py-0 pe-[3px]' tooltip={workerName}>
        <div
          className='group/item relative flex h-7 w-full cursor-pointer items-center justify-between'
          onClick={() => onOpenChange(!open)}>
          <div className='flex min-w-0 grow items-center'>
            <div
              className={cn(
                'mr-2 size-2 shrink-0 rounded-full',
                getOptionColor((worker.color ?? 'gray') as SelectOptionColor).swatch
              )}
            />
            <span className='truncate group-data-[collapsible=icon]:hidden'>{workerName}</span>
            {showDriftDot && (
              // Own click target (3-dot menu's exact stopPropagation/preventDefault recipe) so
              // clicking the dot opens Apply-times without also toggling the section collapse.
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  if (canEdit) setApplyOpen(true)
                }}
                className='ml-1 flex shrink-0 items-center group-data-[collapsible=icon]:hidden'>
                <Tooltip
                  content={
                    drift === 'drifted'
                      ? autoApplyTimes
                        ? 'Order conflicts with confirmed times — auto-sync keeps promised times fixed; reapply to override'
                        : "Times don't match route order — reapply"
                      : 'Times not applied yet'
                  }>
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      drift === 'drifted' ? 'bg-amber-500' : 'bg-muted-foreground/40',
                      canEdit && 'cursor-pointer'
                    )}
                  />
                </Tooltip>
              </div>
            )}
            <span className='ml-1 inline-flex shrink-0 items-center text-muted-foreground group-data-[collapsible=icon]:hidden'>
              <CollapsibleChevron open={open} />
            </span>
          </div>

          <div className='flex shrink-0 items-center group-data-[collapsible=icon]:hidden'>
            {!menuOpen && (
              <>
                <span className='pointer-events-none text-xs text-muted-foreground sm:hidden'>
                  {stops.length}
                </span>
                <div className='pointer-events-none absolute right-[11px] top-1/2 hidden -translate-y-1/2 text-right text-xs sm:flex sm:group-hover/item:opacity-0'>
                  {stops.length}
                </div>
              </>
            )}
            {canEdit && (
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}>
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className={cn(
                        'size-6 shrink-0 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50',
                        {
                          'bg-primary-200 opacity-100': menuOpen,
                          'sm:group-hover/item:opacity-100': !menuOpen,
                        }
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        setMenuOpen(!menuOpen)
                      }}>
                      <MoreVertical className='size-3.5' />
                      <span className='sr-only'>Route options</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className='w-50' align='start'>
                    <DropdownMenuItem onClick={handleSuggest}>
                      <RouteIcon />
                      Suggest route
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setApplyOpen(true)}>
                      <Timer />
                      Apply times
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </SidebarMenuButton>

      <SidebarGroupCollapse open={open}>
        {/* Flush stop list (`inset={false}`): the worker header row already conveys grouping, so
            stops align directly under it with no extra indent or guide line. */}
        <SidebarMenuSub inset={false} className='me-0 pe-0'>
          {stops.length === 0 ? (
            <li className='px-1 py-1 text-xs text-muted-foreground'>No stops today.</li>
          ) : (
            <SortableContext items={stops.map((v) => v.id)} strategy={verticalListSortingStrategy}>
              {stops.map((visit, index) => (
                <StopRow
                  key={visit.id}
                  visit={visit}
                  index={index}
                  assigneeWorkerId={worker.id}
                  workOrder={workOrderById.get(visit.workOrderId)}
                  eta={estimateArrivalForVisit(dayStart, geometry, visit.id)}
                  canEdit={canEdit}
                  onSelectVisit={onSelectVisit}
                  onRemove={() => assignVisit.mutate({ visitId: visit.id, assigneeWorkerId: null })}
                />
              ))}
            </SortableContext>
          )}
        </SidebarMenuSub>
      </SidebarGroupCollapse>

      <ApplyTimesDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        worker={worker}
        stops={activeStops}
        geometry={geometry}
        date={date}
      />
    </SidebarMenuItem>
  )
}

interface StopRowProps {
  visit: PlannerVisit
  index: number
  /** The owning section's `DispatchWorker.id` — never a `User.id` (teams have none). */
  assigneeWorkerId: string
  workOrder: PlannerWorkOrder | undefined
  eta: Date | null
  canEdit: boolean
  onSelectVisit?: (sel: { workOrderId: string; visitId: string }) => void
  onRemove: () => void
}

function StopRow({
  visit,
  index,
  assigneeWorkerId,
  workOrder,
  eta,
  canEdit,
  onSelectVisit,
  onRemove,
}: StopRowProps) {
  const isDone = visit.status === 'done'
  const draggable = canEdit && !isDone
  // `item` rides along in the sortable's data (BacklogRow's exact recipe) so the shared
  // `AppDragOverlay`/`renderAppDragGhost` can render the cursor ghost without a cross-context
  // store lookup — the drag-end handler itself only reads `visitId`/`assigneeWorkerId`.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: visit.id,
    data: {
      type: 'planner-stop',
      visitId: visit.id,
      assigneeWorkerId,
      item: {
        visit,
        workOrder: workOrder
          ? { number: workOrder.number, displayName: workOrder.displayName }
          : undefined,
      },
    },
    disabled: !draggable,
  })

  return (
    <SidebarMenuSubItem>
      {/* `asChild` + div root (entity-folder.tsx's recipe): the row hosts a nested remove
          <Button>, so its own root must not be a <button>. */}
      <SidebarMenuSubButton asChild className='h-7 py-0 pe-[3px]'>
        <div
          ref={setNodeRef}
          {...(draggable ? { ...attributes, ...listeners } : {})}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          onClick={
            onSelectVisit
              ? () => onSelectVisit({ workOrderId: visit.workOrderId, visitId: visit.id })
              : undefined
          }
          className={cn(
            'group/item relative flex h-7 w-full items-center justify-between',
            onSelectVisit && 'cursor-pointer',
            draggable && 'cursor-grab touch-none active:cursor-grabbing',
            isDone && 'opacity-50',
            isDragging && 'opacity-40'
          )}>
          <div className='flex min-w-0 grow items-center'>
            <span className='mr-2 shrink-0 text-xs text-muted-foreground tabular-nums'>
              {index + 1}.
            </span>
            <span className='truncate group-data-[collapsible=icon]:hidden'>
              {workOrder?.number ?? 'Work order'}
            </span>
            {workOrder?.addressText === null && (
              <Tooltip content='No service address'>
                <AlertTriangle className='ml-1 size-3.5 shrink-0 text-amber-500 group-data-[collapsible=icon]:hidden' />
              </Tooltip>
            )}
          </div>

          <div className='flex shrink-0 items-center group-data-[collapsible=icon]:hidden'>
            {eta && (
              <>
                <span className='pointer-events-none text-xs text-muted-foreground sm:hidden'>
                  {format(eta, 'p')}
                </span>
                <span
                  className={cn(
                    'pointer-events-none absolute right-[11px] top-1/2 hidden -translate-y-1/2 text-xs text-muted-foreground sm:flex',
                    draggable && 'sm:group-hover/item:opacity-0'
                  )}>
                  {format(eta, 'p')}
                </span>
              </>
            )}
            {draggable && (
              <Button
                variant='ghost'
                size='icon'
                title='Remove from route'
                className='size-6 shrink-0 rounded-md opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50'
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onRemove()
                }}
                onPointerDown={(e) => e.stopPropagation()}>
                <X className='size-3.5' />
                <span className='sr-only'>Remove from route</span>
              </Button>
            )}
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

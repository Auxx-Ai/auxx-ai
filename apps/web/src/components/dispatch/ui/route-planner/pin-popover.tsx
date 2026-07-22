// apps/web/src/components/dispatch/ui/route-planner/pin-popover.tsx

'use client'

import { getActorRawId, toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { endOfDay, format, startOfDay } from 'date-fns'
import { ArrowLeft, User, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getInitials } from '~/components/groups/utils/group-utils'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useActors, useAvailableActors } from '~/components/resources/hooks/use-actor'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { stopsForWorker, useRoutePlannerMutations } from './hooks/use-route-planner-mutations'
import type { PlannerBoard, PlannerDayWindow, PlannerVisit } from './types'

export interface PinPopoverContentProps {
  visit: PlannerVisit
  board: PlannerBoard
  onClose: () => void
}

/**
 * Map pin click popover (design doc §E, seam contract's `PinPopoverContent`) — 2A's
 * `planner-map.tsx` opens this INSIDE its own popover anchored at the pin; this component is
 * content only (no `Popover`/`PopoverContent` wrapper of its own). Composes `ActorPickerContent`
 * inline via a local section-swap (`schedule-popover.tsx`'s doc comment / precedent) instead of
 * nesting a second popover.
 *
 * The seam signature has no `date`/window prop, so the planned day is derived from the visit's
 * own `startTime` (client-computed day bounds — the `getBoard`/`listMyVisits` convention this
 * whole feature follows); an unscheduled-but-geocoded visit (no `startTime`) falls back to
 * today, which only matters for the position-in-route affordance below, itself hidden when the
 * visit has no assignee yet.
 */
export function PinPopoverContent({ visit, board, onClose }: PinPopoverContentProps) {
  const [mode, setMode] = useState<'actions' | 'assignee'>('actions')

  const dayWindow = useMemo((): PlannerDayWindow => {
    const anchor = visit.startTime ? new Date(visit.startTime) : new Date()
    return {
      from: startOfDay(anchor),
      to: endOfDay(anchor),
      dateKey: format(anchor, 'yyyy-MM-dd'),
    }
  }, [visit.startTime])

  const { setRouteOrder, assignVisit } = useRoutePlannerMutations(dayWindow)

  const workOrder = board.workOrders.find((w) => w.id === visit.workOrderId)
  const assigneeWorkerId = visit.assigneeWorkerId
  const stops = assigneeWorkerId ? stopsForWorker(board, assigneeWorkerId) : []
  const currentIndex = stops.findIndex((v) => v.id === visit.id)
  // The board only carries the workers visible on this planned day, but the current assignee is
  // always one of them.
  const assigneeWorker = assigneeWorkerId
    ? board.workers.find((w) => w.id === assigneeWorkerId)
    : undefined

  const workersQuery = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const activeWorkers = useMemo(
    () => (workersQuery.data ?? []).filter((w) => w.isActive),
    [workersQuery.data]
  )
  // Reassignment here only offers individuals (a `user` actor picker) — worker/team picking
  // (plan 45-teams.md §5A item 7) is a separate, not-yet-built picker surface. Resolve a picked
  // user actor back to that individual's `DispatchWorker.id` for the mutation.
  const workerIdByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of activeWorkers) if (w.userId) map.set(w.userId, w.id)
    return map
  }, [activeWorkers])
  const allUserActors = useAvailableActors({ target: 'user' })
  const excludeIds = useMemo(() => {
    if (workerIdByUserId.size === 0) return []
    return allUserActors
      .filter((a) => !workerIdByUserId.has(getActorRawId(a.actorId)))
      .map((a) => a.actorId)
  }, [workerIdByUserId, allUserActors])

  // Individuals resolve to their user's identity; teams (`userId: null`) fall back to the
  // worker row's own `name`/`color` in the render below.
  const assigneeActorId = assigneeWorker?.userId ? toActorId('user', assigneeWorker.userId) : null
  const hydratedAssignee = useActors(assigneeActorId ? [assigneeActorId] : [])
  const assigneeActor = assigneeActorId ? hydratedAssignee.get(assigneeActorId) : undefined

  const handleMove = (indexValue: string) => {
    if (!assigneeWorkerId) return
    const index = Number(indexValue)
    const visitIds = stops.map((v) => v.id).filter((id) => id !== visit.id)
    visitIds.splice(index, 0, visit.id)
    setRouteOrder.mutate(
      { assigneeWorkerId, from: dayWindow.from, to: dayWindow.to, visitIds },
      {
        onSuccess: onClose,
        onError: (error) =>
          toastError({
            title: 'Error moving stop',
            description: error.message,
          }),
      }
    )
  }

  const handleRemoveFromRoute = () => {
    if (!assigneeWorkerId) return
    const visitIds = stops.map((v) => v.id).filter((id) => id !== visit.id)
    setRouteOrder.mutate(
      { assigneeWorkerId, from: dayWindow.from, to: dayWindow.to, visitIds },
      {
        onSuccess: onClose,
        onError: (error) =>
          toastError({
            title: 'Error removing stop from route',
            description: error.message,
          }),
      }
    )
  }

  const handleAssign = (actorId: (typeof allUserActors)[number]['actorId']) => {
    const newAssigneeWorkerId = workerIdByUserId.get(getActorRawId(actorId))
    if (!newAssigneeWorkerId) return
    assignVisit.mutate(
      { visitId: visit.id, assigneeWorkerId: newAssigneeWorkerId },
      {
        onSuccess: () => {
          const visitIds = stopsForWorker(board, newAssigneeWorkerId)
            .map((v) => v.id)
            .filter((id) => id !== visit.id)
          visitIds.push(visit.id)
          setRouteOrder.mutate({
            assigneeWorkerId: newAssigneeWorkerId,
            from: dayWindow.from,
            to: dayWindow.to,
            visitIds,
          })
          onClose()
        },
        onError: (error) =>
          toastError({
            title: 'Error reassigning visit',
            description: error.message,
          }),
      }
    )
  }

  if (mode === 'assignee') {
    return (
      <div className='w-72'>
        <div className='flex items-center gap-1 border-b p-2'>
          <Button variant='ghost' size='icon' className='size-6' onClick={() => setMode('actions')}>
            <ArrowLeft />
          </Button>
          <span className='text-sm font-medium'>Assign</span>
        </div>
        <ActorPickerContent
          value={assigneeActorId ? [assigneeActorId] : []}
          onChange={() => {}}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          onSelectSingle={(actorId) => {
            handleAssign(actorId)
            setMode('actions')
          }}
          placeholder='Search workers...'
        />
      </div>
    )
  }

  return (
    <div className='w-72 space-y-3 p-3'>
      <div>
        <div className='truncate text-sm font-medium'>
          {workOrder?.number ? `${workOrder.number} · ` : ''}
          {workOrder?.displayName ?? 'Work order'}
        </div>
        {workOrder?.contactDisplayName && (
          <div className='text-muted-foreground truncate text-xs'>
            {workOrder.contactDisplayName}
          </div>
        )}
      </div>

      <Button
        variant='outline'
        size='sm'
        className='w-full justify-start'
        onClick={() => setMode('assignee')}>
        {assigneeActor ? (
          <>
            <Avatar className='size-4'>
              <AvatarImage src={assigneeActor.avatarUrl ?? undefined} />
              <AvatarFallback className='text-[9px]'>
                {getInitials(assigneeActor.name)}
              </AvatarFallback>
            </Avatar>
            {assigneeActor.name}
          </>
        ) : assigneeWorker?.type === 'team' ? (
          <>
            <Avatar className='size-4'>
              <AvatarFallback className='text-[9px]'>
                {assigneeWorker.name ? (
                  getInitials(assigneeWorker.name)
                ) : (
                  <Users className='size-3' />
                )}
              </AvatarFallback>
            </Avatar>
            {assigneeWorker.name ?? 'Team'}
          </>
        ) : (
          <>
            <User /> Unassigned
          </>
        )}
      </Button>

      {assigneeWorkerId && stops.length > 0 && (
        <Select value={String(Math.max(currentIndex, 0))} onValueChange={handleMove}>
          <SelectTrigger size='sm' className='w-full'>
            <SelectValue placeholder='Move to position' />
          </SelectTrigger>
          <SelectContent>
            {stops.map((_, index) => (
              <SelectItem key={stops[index]!.id} value={String(index)}>
                Position {index + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {assigneeWorkerId && (
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-start'
          onClick={handleRemoveFromRoute}
          loading={setRouteOrder.isPending}>
          <X /> Remove from route
        </Button>
      )}
    </div>
  )
}

// apps/web/src/components/dispatch/ui/route-planner/hooks/use-route-planner-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import type { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { differenceInMinutes } from 'date-fns'
import { useCallback } from 'react'
import { createDateWithTime } from '~/components/pickers/date-time-picker/utils'
import { api } from '~/trpc/react'
import type { BacklogItem } from '../../board/types'
import type {
  PlannerBoard,
  PlannerDayWindow,
  PlannerVisit,
  PlannerWorker,
  RouteGeometry,
} from '../types'

// ── Drag data shapes (this module's seam contribution — 2A's route-planner-view.tsx only
// mounts a DndContext and forwards `onDragEnd`; it never builds these payloads) ──────────────
//
// - Backlog row draggable (backlog-group.tsx): `useDraggable({ id: \`sidebar-backlog-${visitId}\`,
//   data: { type: 'planner-backlog', visitId, item } })` — `item` (the full `BacklogItem`) rides
//   along only for the shared drag-ghost overlay (`AppDragOverlay`/`renderAppDragGhost`) to read;
//   this handler still only needs `visitId`.
// - Stop row draggable (sidebar routes-group.tsx), inside a worker's `SortableContext`:
//   `useSortable({ id: visitId })` combined with `data: { type: 'planner-stop', visitId,
//   assigneeUserId, item } }` passed to the same `useSortable` call (dnd-kit merges `data` from
//   `useSortable`'s options onto the draggable/droppable it registers). Like the backlog row,
//   `item` exists only for the shared drag-ghost overlay.
// - Worker section droppable (routes-group.tsx) — catches drops on the section body itself
//   (an empty list, or past the last row), not just a specific stop row:
//   `useDroppable({ id: \`planner-worker-list-${assigneeUserId}\`, data: { type:
//   'planner-worker-list', assigneeUserId } })`.

export interface PlannerBacklogDragData {
  type: 'planner-backlog'
  visitId: string
}
export interface PlannerStopDragData {
  type: 'planner-stop'
  visitId: string
  assigneeUserId: string
  /** Ghost payload for `renderAppDragGhost` only — never read by the drag-end handler. */
  item?: BacklogItem
}
export interface PlannerWorkerListDropData {
  type: 'planner-worker-list'
  /** `null` = the sidebar Workers group's synthetic "Unassigned" row (workers-group.tsx). */
  assigneeUserId: string | null
}
export type PlannerDragData = PlannerBacklogDragData | PlannerStopDragData
export type PlannerDropData = PlannerStopDragData | PlannerWorkerListDropData

/**
 * A visit's on-site duration for ETA math (plan 20 §4.1a read order): explicit
 * `WorkOrderVisit.durationMinutes` (dispatcher/customer-confirmed intent) → the visit's own
 * scheduled span when it has one → the planner-wide "1h default" fallback
 * (apply-times-dialog.tsx, stop-list-panel.tsx). Planner writes (apply-times, slot-in) only
 * ever consume this — they never set `durationMinutes` themselves.
 */
export function visitDurationMinutes(
  visit: Pick<PlannerVisit, 'startTime' | 'endTime' | 'durationMinutes'>
): number {
  if (visit.durationMinutes !== null && visit.durationMinutes !== undefined) {
    return visit.durationMinutes
  }
  if (visit.startTime && visit.endTime) {
    const minutes = differenceInMinutes(new Date(visit.endTime), new Date(visit.startTime))
    if (minutes > 0) return minutes
  }
  return 60
}

/** Active (non-canceled) visits for one worker's day, ordered by `routeOrder` (nulls last). */
export function stopsForWorker(board: PlannerBoard, assigneeUserId: string): PlannerVisit[] {
  return [...board.visits]
    .filter((v) => v.assigneeUserId === assigneeUserId && v.status !== 'canceled')
    .sort((a, b) => {
      if (a.routeOrder === null && b.routeOrder === null) return 0
      if (a.routeOrder === null) return 1
      if (b.routeOrder === null) return -1
      return a.routeOrder - b.routeOrder
    })
}

export type RouteTimesDriftState = 'in-sync' | 'drifted' | 'unapplied'

/**
 * Whether a worker's route order and scheduled start times agree (plan 20 §3.1 — order
 * monotonicity, not time-magnitude, is the drift signal: geometry-free and immune to Directions
 * re-estimate flapping). Only stops still "in the plan" count: `routeOrder !== null` and status
 * not `done`/`canceled`; sorted by `routeOrder` defensively (callers usually already pass
 * `stopsForWorker`'s order, but this must not assume it).
 *
 * - `'unapplied'` — none of the ordered stops has a `startTime` yet (a fresh plan that was never
 *   applied).
 * - `'drifted'` — either the mixed case (some ordered stops have a `startTime`, some don't — a
 *   slot-in whose time write failed, or a manually cleared time), or every ordered stop has a
 *   time but the `startTime` sequence (in `routeOrder` order) isn't non-decreasing (a reorder
 *   that hasn't been re-applied yet).
 * - `'in-sync'` — otherwise, including fewer than two timed stops (nothing to invert).
 */
export function routeTimesDrift(stops: PlannerVisit[]): RouteTimesDriftState {
  const ordered = stops
    .filter((v) => v.routeOrder !== null && v.status !== 'done' && v.status !== 'canceled')
    .sort((a, b) => a.routeOrder! - b.routeOrder!)

  const timed = ordered.filter((v) => v.startTime !== null)
  if (timed.length === 0) return 'unapplied'
  if (timed.length !== ordered.length) return 'drifted'

  for (let i = 1; i < timed.length; i++) {
    const prev = new Date(timed[i - 1]!.startTime as unknown as string | Date)
    const curr = new Date(timed[i]!.startTime as unknown as string | Date)
    if (curr.getTime() < prev.getTime()) return 'drifted'
  }
  return 'in-sync'
}

function parseClock(clock: string | null | undefined, fallback: string): [number, number] {
  const [h, m] = (clock ?? fallback).split(':').map(Number)
  return [Number.isFinite(h) ? (h as number) : 8, Number.isFinite(m) ? (m as number) : 0]
}

/**
 * A route's day-start anchor: the worker's availability start for the planned day, else
 * `fallbackClock` (`'HH:mm'`). Used both for the stop-list ETA badges (fallback `'08:00'`) and
 * the backlog slot-in gesture's geometry-present branch (same fallback).
 */
export function dayStartAnchor(
  window: PlannerDayWindow,
  worker: PlannerWorker | undefined,
  fallbackClock: string
): Date {
  const [hours, minutes] = parseClock(worker?.availabilityStart, fallbackClock)
  return createDateWithTime(window.from, hours, minutes)
}

/**
 * Cumulative travel-only arrival at stop `index` (0-based) of an ordered route: `dayStart` plus
 * the sum of `geometry.legs[0..index].seconds`. This is the read-only "arrives ~" preview math
 * (design doc §C) — it does NOT add on-site duration between stops (that's `applyRouteTimes`'s
 * job, a different chain — see `apply-times-dialog.tsx`). Returns `null` when there's no
 * geometry yet (still loading, or the worker has no geocoded stops).
 *
 * Index-based — only safe for a position that doesn't correspond to an existing leg yet (the
 * backlog slot-in gesture, estimating a provisional time for a visit not in `geometry` at all).
 * For an EXISTING stop, use {@link estimateArrivalForVisit} instead — `getRouteGeometryForWorker`
 * doesn't filter by visit status, so a row's on-screen position can drift from its leg's index
 * when done/canceled stops are interleaved; matching by `toVisitId` sidesteps that entirely.
 */
export function estimateArrival(
  dayStart: Date,
  geometry: RouteGeometry | undefined,
  index: number
): Date | null {
  if (!geometry || geometry.legs.length === 0) return null
  let cumulativeSeconds = 0
  for (let i = 0; i <= index && i < geometry.legs.length; i++) {
    cumulativeSeconds += geometry.legs[i]!.seconds
  }
  return new Date(dayStart.getTime() + cumulativeSeconds * 1000)
}

/**
 * Cumulative travel-only arrival for a specific, already-geocoded visit — looks up its leg by
 * `toVisitId` (robust against status-interleaving, see {@link estimateArrival}'s doc) and sums
 * every leg up to and including it. `null` when there's no geometry yet or the visit has no leg
 * (ungeocoded, or not part of this worker's route).
 */
export function estimateArrivalForVisit(
  dayStart: Date,
  geometry: RouteGeometry | undefined,
  visitId: string
): Date | null {
  if (!geometry || geometry.legs.length === 0) return null
  const legIndex = geometry.legs.findIndex((leg) => leg.toVisitId === visitId)
  if (legIndex === -1) return null
  let cumulativeSeconds = 0
  for (let i = 0; i <= legIndex; i++) {
    cumulativeSeconds += geometry.legs[i]!.seconds
  }
  return new Date(dayStart.getTime() + cumulativeSeconds * 1000)
}

/** Promote/patch one visit by id, wherever it currently lives (`visits` or `backlog`). */
function patchVisitInBoard(
  board: PlannerBoard,
  visitId: string,
  patch: Partial<PlannerVisit>
): PlannerBoard {
  let found = false
  const visits = board.visits.map((v) => {
    if (v.id !== visitId) return v
    found = true
    return { ...v, ...patch }
  })
  if (found) return { ...board, visits }

  // The slot-in gesture schedules a still-backlogged visit — move it out of `backlog` into
  // `visits` immediately so the stop-list panel shows it without waiting for a refetch.
  const backlogVisit = board.backlog.find((v) => v.id === visitId)
  if (!backlogVisit) return board
  return {
    ...board,
    backlog: board.backlog.filter((v) => v.id !== visitId),
    visits: [...board.visits, { ...backlogVisit, ...patch }],
  }
}

/** `setRouteOrder`'s write shape, mirrored client-side (contract item 4): `visitIds`' index
 * becomes the new `routeOrder`; any OTHER visit of that assignee+day that had a non-null
 * `routeOrder` but isn't in the list gets nulled out. */
function patchRouteOrder(
  board: PlannerBoard,
  assigneeUserId: string,
  visitIds: string[]
): PlannerBoard {
  const orderIndex = new Map(visitIds.map((id, index) => [id, index]))
  return {
    ...board,
    visits: board.visits.map((v) => {
      if (v.assigneeUserId !== assigneeUserId) return v
      const index = orderIndex.get(v.id)
      if (index !== undefined) return { ...v, routeOrder: index }
      return v.routeOrder !== null ? { ...v, routeOrder: null } : v
    }),
  }
}

/**
 * All visit-mutating writes the route planner makes, optimistically patched against the
 * `dispatch.getRoutePlannerBoard` cache (the `use-board-mutations.ts` snapshot → patch →
 * rollback-on-error → invalidate-on-settle trio). `window` is the exact `{ from, to, dateKey }`
 * the caller's board query was made with (no `workerIds` — the planner follows the board's own
 * `WorkerFilterPopover` precedent of filtering the rendered set client-side via `PlannerFilters`,
 * not re-querying per worker selection, so there's exactly one cached board per window).
 * `onSettled` also broadly invalidates every cached `getRouteGeometry` result (any assignee),
 * since a reorder/reassign/retime can change any visible worker's route geometry.
 */
export function useRoutePlannerMutations(window: PlannerDayWindow) {
  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const boardKey = { from: window.from, to: window.to, dateKey: window.dateKey }
  const boardQueryKeyPrefix = getQueryKey(api.dispatch.getRoutePlannerBoard)
  const geometryQueryKeyPrefix = getQueryKey(api.dispatch.getRouteGeometry)

  const patchBoard = (patch: (board: PlannerBoard) => PlannerBoard): PlannerBoard | undefined => {
    const previous = utils.dispatch.getRoutePlannerBoard.getData(boardKey)
    if (previous) utils.dispatch.getRoutePlannerBoard.setData(boardKey, patch(previous))
    return previous
  }
  const rollback = (previous: PlannerBoard | undefined) => {
    if (previous) utils.dispatch.getRoutePlannerBoard.setData(boardKey, previous)
  }
  const settle = () => {
    // Exact-key invalidate covers the common (unfiltered) case; the broad predicate below also
    // catches any `workerIds`-filtered variant a caller might have queried, keyed only on
    // `dateKey` (the query's `from`/`to`/`dateKey` always describe the same planned day here).
    void utils.dispatch.getRoutePlannerBoard.invalidate(boardKey)
    void queryClient.invalidateQueries({
      queryKey: boardQueryKeyPrefix,
      predicate: (query) => {
        const input = (query.queryKey[1] as { input?: { dateKey?: string } } | undefined)?.input
        return input?.dateKey === window.dateKey
      },
    })
    void queryClient.invalidateQueries({ queryKey: geometryQueryKeyPrefix })
  }

  const setRouteOrderMutation = api.dispatch.setRouteOrder.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getRoutePlannerBoard.cancel(boardKey)
      return {
        previous: patchBoard((board) => patchRouteOrder(board, vars.assigneeUserId, vars.visitIds)),
      }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error reordering route', description: error.message })
    },
    onSettled: settle,
  })
  // `dateKey` (plan 20 §5 — server needs it to scope the auto-sync anchored chain to the right
  // planned day) always equals this hook's own `window.dateKey` — every caller already
  // constructs its `setRouteOrder.mutate` vars from a `PlannerDayWindow` in scope, so it's
  // threaded here once instead of at each of the ~6 call sites (drag-end, pin-popover, Suggest
  // route). Same source `applyRouteTimes` already uses (`date.dateKey` in apply-times-dialog.tsx).
  type SetRouteOrderVars = Parameters<typeof setRouteOrderMutation.mutate>[0]
  type SetRouteOrderOptions = Parameters<typeof setRouteOrderMutation.mutate>[1]
  const setRouteOrder = {
    ...setRouteOrderMutation,
    mutate: (vars: Omit<SetRouteOrderVars, 'dateKey'>, options?: SetRouteOrderOptions) =>
      setRouteOrderMutation.mutate({ ...vars, dateKey: window.dateKey }, options),
  }

  const applyRouteTimes = api.dispatch.applyRouteTimes.useMutation({
    onMutate: async () => {
      await utils.dispatch.getRoutePlannerBoard.cancel(boardKey)
      // No optimistic start/end-time patch here: the exact chain (§F item 12 — departure ->
      // leg -> arrival -> dwell -> next departure) needs the same Directions legs the
      // Apply-times dialog already computed for its own preview, and duplicating that math in
      // this hook (which has no geometry input) would just be a second copy of it. The dialog
      // closes immediately on success (apply-times-dialog.tsx) and `settle` below refreshes the
      // board within one round-trip — still cancel/rollback-safe against a racing reorder.
      const previous = utils.dispatch.getRoutePlannerBoard.getData(boardKey)
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error applying times', description: error.message })
    },
    onSettled: settle,
  })

  const scheduleVisit = api.dispatch.scheduleVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getRoutePlannerBoard.cancel(boardKey)
      const patch: Partial<PlannerVisit> = { startTime: vars.startTime, endTime: vars.endTime }
      if (vars.assigneeUserId !== undefined) patch.assigneeUserId = vars.assigneeUserId
      return { previous: patchBoard((board) => patchVisitInBoard(board, vars.visitId, patch)) }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error scheduling visit', description: error.message })
    },
    onSettled: settle,
  })

  const assignVisit = api.dispatch.assignVisit.useMutation({
    onMutate: async (vars) => {
      await utils.dispatch.getRoutePlannerBoard.cancel(boardKey)
      return {
        previous: patchBoard((board) =>
          patchVisitInBoard(board, vars.visitId, { assigneeUserId: vars.assigneeUserId })
        ),
      }
    },
    onError: (error, _vars, ctx) => {
      rollback(ctx?.previous)
      toastError({ title: 'Error reassigning visit', description: error.message })
    },
    onSettled: settle,
  })

  return { setRouteOrder, applyRouteTimes, scheduleVisit, assignVisit }
}

export interface UseRoutePlannerDragEndArgs {
  board: PlannerBoard
  window: PlannerDayWindow
  geometryByWorker: Record<string, RouteGeometry | undefined>
}

/**
 * The route planner's single `DndContext.onDragEnd` handler (seam contract's DnD note): 2A's
 * `route-planner-view.tsx` mounts its own `DndContext` and forwards this one line — it never
 * builds the drag payloads above. Branches on `active.data.current.type`:
 *  - `'planner-backlog'` dropped on a worker's stop list/stop → the slot-in gesture (design doc
 *    §E, decision #8): one `scheduleVisit` call with a provisional `startTime` interpolated from
 *    the target worker's `RouteGeometry` (day-start anchor + cumulative leg seconds up to the
 *    drop position; day at 09:00 local when there's no geometry yet), then a follow-up
 *    `setRouteOrder` splicing the visit into the drop position.
 *  - `'planner-stop'` dropped within the SAME worker's list → reorder (`setRouteOrder`).
 *  - `'planner-stop'` dropped on ANOTHER worker's list/stop → reassign (`assignVisit`, then
 *    `setRouteOrder` inserting at the drop position on the target's route).
 */
export function useRoutePlannerDragEnd({
  board,
  window,
  geometryByWorker,
}: UseRoutePlannerDragEndArgs) {
  const mutations = useRoutePlannerMutations(window)

  return useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeData = active.data.current as PlannerDragData | undefined
      const overData = over.data.current as PlannerDropData | undefined
      if (!activeData || !overData) return

      const targetAssigneeUserId = overData.assigneeUserId
      if (targetAssigneeUserId === null) {
        // The Workers group's "Unassigned" row: a stop drops back to unassigned (no
        // `setRouteOrder` follow-up — the router input requires a real assignee); a backlog
        // item is already unassigned, so there's nothing to do.
        if (activeData.type === 'planner-stop') {
          mutations.assignVisit.mutate({ visitId: activeData.visitId, assigneeUserId: null })
        }
        return
      }
      const targetStops = stopsForWorker(board, targetAssigneeUserId)
      const targetIds = targetStops.map((v) => v.id)
      let dropIndex =
        overData.type === 'planner-stop' ? targetIds.indexOf(overData.visitId) : targetIds.length
      if (dropIndex === -1) dropIndex = targetIds.length

      if (activeData.type === 'planner-backlog') {
        const visit =
          board.backlog.find((v) => v.id === activeData.visitId) ??
          board.visits.find((v) => v.id === activeData.visitId)
        if (!visit) return

        const worker = board.workers.find((w) => w.userId === targetAssigneeUserId)
        const geometry = geometryByWorker[targetAssigneeUserId]
        const startTime =
          estimateArrival(dayStartAnchor(window, worker, '08:00'), geometry, dropIndex) ??
          createDateWithTime(window.from, 9, 0)
        const endTime = new Date(startTime.getTime() + visitDurationMinutes(visit) * 60_000)

        mutations.scheduleVisit.mutate(
          {
            visitId: visit.id,
            startTime,
            endTime,
            assigneeUserId: targetAssigneeUserId,
            // The human chose worker + drop position, not the time itself — this is
            // travel-only ETA math (plan 20 §4.2), not a promise to the customer.
            timeWriteKind: 'provisional',
          },
          {
            onSuccess: () => {
              const nextIds = [...targetIds]
              nextIds.splice(dropIndex, 0, visit.id)
              mutations.setRouteOrder.mutate({
                assigneeUserId: targetAssigneeUserId,
                from: window.from,
                to: window.to,
                visitIds: nextIds,
              })
            },
          }
        )
        return
      }

      // 'planner-stop'
      if (activeData.assigneeUserId === targetAssigneeUserId) {
        const oldIndex = targetIds.indexOf(activeData.visitId)
        if (oldIndex === -1 || oldIndex === dropIndex) return
        mutations.setRouteOrder.mutate({
          assigneeUserId: targetAssigneeUserId,
          from: window.from,
          to: window.to,
          visitIds: arrayMove(targetIds, oldIndex, dropIndex),
        })
        return
      }

      mutations.assignVisit.mutate(
        { visitId: activeData.visitId, assigneeUserId: targetAssigneeUserId },
        {
          onSuccess: () => {
            const nextIds = targetIds.filter((id) => id !== activeData.visitId)
            nextIds.splice(dropIndex, 0, activeData.visitId)
            mutations.setRouteOrder.mutate({
              assigneeUserId: targetAssigneeUserId,
              from: window.from,
              to: window.to,
              visitIds: nextIds,
            })
          },
        }
      )
    },
    [board, window, geometryByWorker, mutations]
  )
}

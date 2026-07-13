// apps/web/src/components/dispatch/ui/route-planner/hooks/use-route-planner-data.ts

'use client'

import { endOfDay, format, startOfDay } from 'date-fns'
import { useCallback, useMemo, useState } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import type { PlannerBoard, PlannerDayWindow, PlannerFilters, RouteGeometry } from '../types'

const EMPTY_BOARD: PlannerBoard = { workers: [], visits: [], backlog: [], workOrders: [] }

interface UseRoutePlannerDataParams {
  /** The board's viewed day (map mode always shows a single day — 09-route-planner.md §A). */
  date: Date
  /** The board's shared worker filter (the sidebar's Workers toggles via
   * `selectedWorkerIdsFromHidden`). */
  selectedWorkerIds: Set<string> | null
  /** Skip fetching while the map surface isn't mounted/visible (board mode is 'calendar'). */
  enabled?: boolean
}

/**
 * Route planner data (09-route-planner.md §Frontend, contract's "Phase 2A" hook): derives the
 * day window from the board's `date` (client-computed — the server is timezone-naive, same
 * convention as `getBoard`/`listMyVisits`), loads `getRoutePlannerBoard` plus one
 * `getRouteGeometry` per visible worker (`api.useQueries`, the `use-availability-shading.ts`
 * recipe for a dynamic-length query list), and keeps both fresh on `dispatch:visit-changed`
 * realtime broadcasts (mirrors `use-board-realtime.ts`).
 *
 * `filters.workerIds` mirrors the board's own day-view convention: `selectedWorkerIds` comes in
 * from the shared board state (narrows which workers' routes are drawn/fetched), `tags` is
 * managed locally here since no other surface needs it. `setFilters` only persists the `tags`
 * half of whatever `PlannerFilters` it's given — `workerIds` always reflects the live
 * `selectedWorkerIds` param on the next render, it isn't a copy held in local state.
 */
export function useRoutePlannerData({
  date,
  selectedWorkerIds,
  enabled = true,
}: UseRoutePlannerDataParams) {
  const window: PlannerDayWindow = useMemo(
    () => ({ from: startOfDay(date), to: endOfDay(date), dateKey: format(date, 'yyyy-MM-dd') }),
    [date]
  )

  const [tags, setTags] = useState<Set<string> | null>(null)
  const filters: PlannerFilters = useMemo(
    () => ({ workerIds: selectedWorkerIds, tags }),
    [selectedWorkerIds, tags]
  )
  const setFilters = useCallback((next: PlannerFilters) => setTags(next.tags), [])

  const boardQuery = api.dispatch.getRoutePlannerBoard.useQuery(
    { from: window.from, to: window.to, dateKey: window.dateKey },
    { placeholderData: (prev) => prev, enabled }
  )
  const board: PlannerBoard = boardQuery.data ?? EMPTY_BOARD

  // Only the visible (filtered) workers need a geometry query — matches the board's own
  // "filter narrows the rendered set, not the base query" convention (`use-board-data.ts`).
  const visibleWorkers = useMemo(
    () =>
      filters.workerIds
        ? board.workers.filter((w) => filters.workerIds!.has(w.userId))
        : board.workers,
    [board.workers, filters.workerIds]
  )

  const geometryResults = api.useQueries((t) =>
    enabled
      ? visibleWorkers.map((w) =>
          t.dispatch.getRouteGeometry({
            from: window.from,
            to: window.to,
            dateKey: window.dateKey,
            assigneeUserId: w.userId,
          })
        )
      : []
  )

  const geometryByWorker = useMemo(() => {
    const map: Record<string, RouteGeometry | undefined> = {}
    visibleWorkers.forEach((w, i) => {
      map[w.userId] = geometryResults[i]?.data
    })
    return map
  }, [visibleWorkers, geometryResults])

  const utils = api.useUtils()
  const onRealtimeEvent = useCallback(
    (event: string) => {
      if (event !== 'dispatch:visit-changed') return
      void utils.dispatch.getRoutePlannerBoard.invalidate()
      void utils.dispatch.getRouteGeometry.invalidate()
    },
    [utils]
  )
  useOrgChannel({ onEvent: onRealtimeEvent })

  return {
    board,
    window,
    geometryByWorker,
    isLoading: boardQuery.isLoading,
    filters,
    setFilters,
  }
}

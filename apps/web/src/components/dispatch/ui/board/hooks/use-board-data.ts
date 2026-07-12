// apps/web/src/components/dispatch/ui/board/hooks/use-board-data.ts

'use client'

import { endOfDay, endOfMonth, startOfDay, startOfMonth } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import {
  type BoardResourceInput,
  type BoardViewMode,
  type BoardWorker,
  type DispatchVisitEvent,
  UNASSIGNED_RESOURCE_ID,
} from '../types'
import { splitVisits, UNASSIGNED_COLOR, visitToEvent } from '../utils'

export interface DateRange {
  from: Date
  to: Date
}

/**
 * Board date/view/range/filter state + the `dispatch.getBoard` query (D.3). `range` is fed
 * by `EventCalendar`'s `onRangeChange` — stored by timestamp so identical ranges (same
 * day/view recomputed) don't churn the query key.
 */
export function useBoardData() {
  const [date, setDate] = useState(() => new Date())
  const [view, setView] = useState<BoardViewMode>('day')
  // Matches the calendar's own day-view range calc (`startOfDay`/`endOfDay`) so the first
  // `onRangeChange` firing (in the calendar's mount effect) is a no-op query-key match
  // instead of a second fetch.
  const [range, setRange] = useState<DateRange>(() => ({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  }))
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string> | null>(null) // null = all
  const [showBacklog, setShowBacklog] = useState(true)
  // Board↔Map toggle (09-route-planner.md §A, contract item 7) — sibling state to `showBacklog`,
  // deliberately NOT a `BoardViewMode` so the month-view debounce and `view === 'day'` gates stay
  // untouched. Entering map mode doesn't change `view`; the map always renders `date`'s single day.
  const [boardMode, setBoardMode] = useState<'calendar' | 'map'>('calendar')

  const rangeDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(rangeDebounceRef.current), [])

  const handleRangeChange = useCallback(
    (from: Date, to: Date) => {
      // The month stream reports a sliding week window on every scroll — quantize it to
      // whole covering months so the `getBoard` query key only changes when a new month
      // scrolls into view, and debounce so a fast fling doesn't fetch every month crossed.
      const quantizedFrom = view === 'month' ? startOfMonth(from) : from
      const quantizedTo = view === 'month' ? endOfMonth(to) : to
      const apply = () =>
        setRange((prev) =>
          prev.from.getTime() === quantizedFrom.getTime() &&
          prev.to.getTime() === quantizedTo.getTime()
            ? prev
            : { from: quantizedFrom, to: quantizedTo }
        )
      clearTimeout(rangeDebounceRef.current)
      if (view === 'month') {
        rangeDebounceRef.current = setTimeout(apply, 250)
      } else {
        apply()
      }
    },
    [view]
  )

  const boardQuery = api.dispatch.getBoard.useQuery(
    { from: range.from, to: range.to },
    { placeholderData: (prev) => prev }
  )

  const allWorkers: BoardWorker[] = boardQuery.data?.workers ?? []
  const workers = useMemo(
    () =>
      selectedWorkerIds ? allWorkers.filter((w) => selectedWorkerIds.has(w.userId)) : allWorkers,
    [allWorkers, selectedWorkerIds]
  )

  const colorByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of allWorkers) {
      if (w.color) map.set(w.userId, w.color)
    }
    return map
  }, [allWorkers])

  const workOrderById = useMemo(
    () => new Map((boardQuery.data?.workOrders ?? []).map((wo) => [wo.id, wo])),
    [boardQuery.data?.workOrders]
  )

  const { scheduled, backlog } = useMemo(
    () => splitVisits(boardQuery.data?.visits ?? []),
    [boardQuery.data?.visits]
  )

  const allEvents: DispatchVisitEvent[] = useMemo(
    () => scheduled.map((v) => visitToEvent(v, workOrderById, colorByUserId)),
    [scheduled, workOrderById, colorByUserId]
  )

  // Day (resource) view only shows the filtered worker set's + unassigned's visits — the
  // other columns don't exist on the grid. Week/month show everything regardless of filter
  // (no columns to hide behind), so the filter is a day-view-only lens.
  const visibleWorkerUserIds = useMemo(() => new Set(workers.map((w) => w.userId)), [workers])
  const events = useMemo(() => {
    if (view !== 'day') return allEvents
    return allEvents.filter(
      (e) => e.resourceId === UNASSIGNED_RESOURCE_ID || visibleWorkerUserIds.has(e.resourceId!)
    )
  }, [allEvents, view, visibleWorkerUserIds])

  const backlogEvents = useMemo(
    () => backlog.map((v) => ({ visit: v, workOrder: workOrderById.get(v.workOrderId) })),
    [backlog, workOrderById]
  )

  const resources: BoardResourceInput[] = useMemo(
    () => [
      { id: UNASSIGNED_RESOURCE_ID, label: 'Unassigned', color: UNASSIGNED_COLOR },
      ...workers.map((w) => ({
        id: w.userId,
        label: w.user?.name ?? w.user?.email ?? 'Worker',
        color: w.color ?? undefined,
        worker: w,
      })),
    ],
    [workers]
  )

  return {
    date,
    setDate,
    view,
    setView,
    range,
    handleRangeChange,
    allWorkers,
    workers,
    selectedWorkerIds,
    setSelectedWorkerIds,
    showBacklog,
    setShowBacklog,
    boardMode,
    setBoardMode,
    resources,
    colorByUserId,
    workOrderById,
    events,
    allEvents,
    backlogEvents,
    isLoading: boardQuery.isLoading,
    refetch: boardQuery.refetch,
  }
}

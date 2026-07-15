// apps/web/src/components/dispatch/ui/board/hooks/use-board-data.ts

'use client'

import { getOptionColorHex } from '@auxx/lib/custom-fields/client'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useCalendarRange } from '~/components/calendar/core/use-calendar-range'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useHiddenWorkerIds } from '../../../stores/dispatch-sidebar-store'
import {
  type BoardResourceInput,
  type BoardWorker,
  type DispatchVisitEvent,
  UNASSIGNED_RESOURCE_ID,
} from '../types'
import {
  isWorkerHidden,
  selectedWorkerIdsFromHidden,
  splitVisits,
  UNASSIGNED_COLOR,
  visitToEvent,
} from '../utils'

/** Re-export of the shared shell's range type — kept here so existing importers of this hook's
 * `DateRange` don't need to repoint (`use-board-mutations.ts`, `use-board-realtime.ts`,
 * `use-availability-shading.ts`). */
export type { DateRange } from '~/components/calendar/core/use-calendar-range'

/**
 * Board date/view/range/filter state + the `dispatch.getBoard` query (D.3). Date/view/range
 * state itself is the shared `useCalendarRange()` (plan §3.2, extracted verbatim from this
 * hook) — `range` is fed by `EventCalendar`'s `onRangeChange` — stored by timestamp so
 * identical ranges (same day/view recomputed) don't churn the query key.
 *
 * `selectedWorkerIds`/Unassigned-column visibility (v3 sidebar plan §1.1/§1.3) derive from the
 * persisted `dispatch-sidebar` store's Workers group hidden set (`useHiddenWorkerIds`) — the
 * sidebar is the only writer, this hook only reads it (via the
 * `selectedWorkerIdsFromHidden`/`isWorkerHidden` adapters) so the board/map/planner consumers
 * below keep their pre-v3 `Set<string> | null` contract untouched.
 */
export function useBoardData() {
  const { date, setDate, view, setView, range, handleRangeChange } = useCalendarRange()
  // Board↔Map toggle (09-route-planner.md §A, contract item 7) — sibling state to the sidebar's
  // `open`, deliberately NOT a `BoardViewMode` so the month-view debounce and `view === 'day'`
  // gates stay untouched. Entering map mode doesn't change `view`; the map always renders
  // `date`'s single day. Persisted in the URL (`?mode=`, nuqs) so a reload/deep-link keeps the
  // active tab, matching the board's other query-synced state (`?record=`).
  const [boardMode, setBoardMode] = useQueryState(
    'mode',
    parseAsStringLiteral(['calendar', 'map'] as const).withDefault('calendar')
  )

  const hiddenWorkerIds = useHiddenWorkerIds()

  const boardQuery = api.dispatch.getBoard.useQuery(
    { from: range.from, to: range.to },
    { placeholderData: (prev) => prev, staleTime: ORG_STATIC_STALE_TIME }
  )

  const allWorkers: BoardWorker[] = boardQuery.data?.workers ?? []

  const selectedWorkerIds = useMemo(
    () => selectedWorkerIdsFromHidden(hiddenWorkerIds, allWorkers),
    [hiddenWorkerIds, allWorkers]
  )
  const showUnassigned = useMemo(() => !isWorkerHidden(hiddenWorkerIds, null), [hiddenWorkerIds])

  const workers = useMemo(
    () =>
      selectedWorkerIds ? allWorkers.filter((w) => selectedWorkerIds.has(w.userId)) : allWorkers,
    [allWorkers, selectedWorkerIds]
  )

  // Resolve the stored `SelectOptionColor` id (e.g. 'amber', 'forest') to a real hex — the
  // calendar feeds this straight into `--ec-color`/`color-mix`, where several ids aren't valid
  // CSS color names and would render as no color at all.
  const colorByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of allWorkers) {
      if (w.color) map.set(w.userId, getOptionColorHex(w.color))
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

  // The resource views (`day`/`timeline`, plan 18) only show the filtered worker set's + (if
  // visible) Unassigned's visits — the other columns don't exist on the grid. Week/month show
  // everything regardless of filter (no columns to hide behind), so this is a resource-view lens.
  const visibleWorkerUserIds = useMemo(() => new Set(workers.map((w) => w.userId)), [workers])
  const events = useMemo(() => {
    if (view !== 'day' && view !== 'timeline') return allEvents
    return allEvents.filter(
      (e) =>
        (showUnassigned && e.resourceId === UNASSIGNED_RESOURCE_ID) ||
        visibleWorkerUserIds.has(e.resourceId!)
    )
  }, [allEvents, view, visibleWorkerUserIds, showUnassigned])

  const backlogEvents = useMemo(
    () =>
      backlog.map((v) => ({
        visit: v,
        workOrder: workOrderById.get(v.workOrderId),
      })),
    [backlog, workOrderById]
  )

  const resources: BoardResourceInput[] = useMemo(
    () => [
      ...(showUnassigned
        ? [
            {
              id: UNASSIGNED_RESOURCE_ID,
              label: 'Unassigned',
              color: UNASSIGNED_COLOR,
            },
          ]
        : []),
      ...workers.map((w) => ({
        id: w.userId,
        label: w.user?.name ?? w.user?.email ?? 'Worker',
        color: w.color ?? undefined,
        worker: w,
      })),
    ],
    [workers, showUnassigned]
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

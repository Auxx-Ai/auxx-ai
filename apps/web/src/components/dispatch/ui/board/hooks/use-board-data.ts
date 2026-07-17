// apps/web/src/components/dispatch/ui/board/hooks/use-board-data.ts

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { getOptionColorHex } from '@auxx/lib/custom-fields/client'
import { format, isSameDay, startOfDay } from 'date-fns'
import { createParser, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useCalendarRange } from '~/components/calendar/core/use-calendar-range'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useDispatchSidebarStore, useHiddenWorkerIds } from '../../../stores/dispatch-sidebar-store'
import {
  type BoardResourceInput,
  type BoardWorker,
  type DispatchVisitEvent,
  UNASSIGNED_RESOURCE_ID,
} from '../types'
import {
  isWorkerHidden,
  scalarSetting,
  selectedWorkerIdsFromHidden,
  splitVisits,
  UNASSIGNED_COLOR,
  visitToEvent,
  withPreservedDayOfMonth,
} from '../utils'

const BOARD_VIEWS = ['day', 'timeline', 'week', 'month'] as const

/** `?date=` holds a bare local day (`YYYY-MM-DD`) — the board's active anchor, shared by Map and
 * every board view. Parsed at LOCAL midnight (not `parseAsIsoDate`'s UTC midnight, which would
 * shift the stored day back a calendar day in western timezones) so the anchor matches the
 * dispatcher's local day. */
const parseAsDay = createParser({
  parse: (raw: string) => {
    const parsed = new Date(`${raw}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed)
  },
  serialize: (date: Date) => format(date, 'yyyy-MM-dd'),
  eq: (a: Date, b: Date) => isSameDay(a, b),
})

/** Re-export of the shared shell's range type — kept here so existing importers of this hook's
 * `DateRange` don't need to repoint (`use-board-mutations.ts`, `use-board-realtime.ts`,
 * `use-availability-shading.ts`). */
export type { DateRange } from '~/components/calendar/core/use-calendar-range'

/**
 * Board date/view/range/filter state + the `dispatch.getBoard` query (D.3). `date` and `view` are
 * URL-persisted here (nuqs `?date=`/`?view=`, alongside `?mode=`) so a reload/deep-link restores
 * the board; they're fed CONTROLLED into the shared `useCalendarRange()` (plan §3.2), which derives
 * `range` from `EventCalendar`'s `onRangeChange` — stored by timestamp so identical ranges (same
 * day/view recomputed) don't churn the query key.
 *
 * `selectedWorkerIds`/Unassigned-column visibility (v3 sidebar plan §1.1/§1.3) derive from the
 * persisted `dispatch-sidebar` store's Workers group hidden set (`useHiddenWorkerIds`) — the
 * sidebar is the only writer, this hook only reads it (via the
 * `selectedWorkerIdsFromHidden`/`isWorkerHidden` adapters) so the board/map/planner consumers
 * below keep their pre-v3 `Set<string> | null` contract untouched.
 */
export function useBoardData() {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStartsOn = weekStartToIndex(
    (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
      | 'monday'
      | 'sunday'
      | 'saturday'
  )

  // Board view + active anchor date, both persisted in the URL (nuqs) so a reload/deep-link lands
  // the dispatcher back where they were. `date` is a single day shared by Map (day-scoped) and
  // every board view — each view derives its own window from it (`useCalendarRange` below).
  const [view, setView] = useQueryState(
    'view',
    parseAsStringLiteral(BOARD_VIEWS).withDefault('day')
  )
  const [date, setDateParam] = useQueryState('date', parseAsDay.withDefault(startOfDay(new Date())))

  // Two write paths into the anchor. `setDate` = window navigation (calendar scroll-settle +
  // toolbar chevrons): in month view it keeps the anchor's day-of-month inside the newly viewed
  // month (`withPreservedDayOfMonth`) so switching back to Map/Day returns to that day; every other
  // view just takes the emitted first/leftmost day. `setDateAbsolute` = an exact day pick (mini
  // calendar, Today), which always sets that day verbatim.
  const setDate = useCallback(
    (next: Date) =>
      setDateParam((prev) =>
        view === 'month'
          ? withPreservedDayOfMonth(prev ?? next, next, weekStartsOn)
          : startOfDay(next)
      ),
    [view, weekStartsOn, setDateParam]
  )
  const setDateAbsolute = useCallback((day: Date) => setDateParam(startOfDay(day)), [setDateParam])

  // `date`/`view` are owned here (URL); the shared range hook is fed them controlled and only
  // supplies the derived `range` + `handleRangeChange`.
  const { range, handleRangeChange } = useCalendarRange('day', weekStartsOn, { date, view })

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
  const showCanceled = useDispatchSidebarStore((s) => s.showCanceled)

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

  // §B.1 "Show canceled" sidebar toggle — `getBoard` keeps returning canceled rows (toggle
  // stays instant, no refetch); this is the seam that filters them out of the calendar chip
  // pipeline. Backlog rows are never canceled (the backlog query only selects `status:
  // 'scheduled'`), so no equivalent filter is needed on `backlogEvents` below.
  const allEvents: DispatchVisitEvent[] = useMemo(
    () =>
      scheduled
        .filter((v) => showCanceled || v.status !== 'canceled')
        .map((v) => visitToEvent(v, workOrderById, colorByUserId)),
    [scheduled, workOrderById, colorByUserId, showCanceled]
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
    setDateAbsolute,
    view,
    setView,
    weekStartsOn,
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

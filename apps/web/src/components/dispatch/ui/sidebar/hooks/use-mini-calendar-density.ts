// apps/web/src/components/dispatch/ui/sidebar/hooks/use-mini-calendar-density.ts

'use client'

import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { useMemo } from 'react'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import type { WeekStartIndex } from '../../board/utils'
import { isWorkerHidden } from '../../board/utils'

/**
 * Mini-calendar day-marker dots (v3 sidebar plan §1.4) — fetches `dispatch.getVisitDayMarkers`
 * for the displayed month expanded to full weeks (the grid's leading/trailing days from
 * adjacent months are visible too), then buckets client-side into `'yyyy-MM-dd'` counts and
 * filters by the sidebar's worker-visibility toggles. Day windows are always CLIENT-computed
 * (the `getBoard`/`listMyVisits` convention) — the query's `to` is an EXCLUSIVE day-after-end
 * boundary (unlike `MiniMonthCalendar`'s own `visibleRange` prop, which is inclusive).
 */
export function useMiniCalendarDensity(
  displayMonth: Date,
  weekStartsOn: WeekStartIndex,
  hiddenWorkerIds: string[],
  includeCanceled = false
) {
  const from = useMemo(
    () => startOfWeek(startOfMonth(displayMonth), { weekStartsOn }),
    [displayMonth, weekStartsOn]
  )
  const to = useMemo(() => {
    const inclusiveEnd = endOfWeek(endOfMonth(displayMonth), { weekStartsOn })
    return new Date(inclusiveEnd.getTime() + 24 * 60 * 60 * 1000) // exclusive end for the query
  }, [displayMonth, weekStartsOn])

  const query = api.dispatch.getVisitDayMarkers.useQuery(
    { from, to, includeCanceled },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const density = useMemo(() => {
    const map: Record<string, number> = {}
    for (const marker of query.data ?? []) {
      if (isWorkerHidden(hiddenWorkerIds, marker.assigneeWorkerId)) continue
      const key = format(new Date(marker.startTime), 'yyyy-MM-dd')
      map[key] = (map[key] ?? 0) + 1
    }
    return map
  }, [query.data, hiddenWorkerIds])

  return { density, isLoading: query.isLoading }
}

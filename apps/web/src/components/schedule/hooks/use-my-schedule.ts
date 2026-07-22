// apps/web/src/components/schedule/hooks/use-my-schedule.ts
//
// The Schedule page's data hook (08-worker-surface.md §2): runs `dispatch.myVisits` +
// `calendar.myMeetings` over a fixed ±4wk window, merges the two sources into one
// time-ordered list, and groups by calendar day for the sticky-header list UI. Visit
// statuses/types are read off `RouterOutputs` rather than imported from `@auxx/lib/dispatch`
// (no `/client` export subpath exists for that module — the board's `types.ts` mirror
// documents the same constraint).

'use client'

import { useQueryClient } from '@tanstack/react-query'
import { addWeeks, format, startOfDay } from 'date-fns'
import { useCallback, useMemo } from 'react'
import { visitTitle } from '~/components/calendar/sources/visits-source'
import { useViewerWorkerIds } from '~/components/dispatch/ui/shared/use-viewer-worker-ids'
import {
  applyVisitToCaches,
  rewrapVisitDates,
  type VisitChangedPayload,
} from '~/components/dispatch/visit-cache'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'

type MyVisit = RouterOutputs['dispatch']['myVisits'][number]
type MyMeeting = RouterOutputs['calendar']['myMeetings'][number]

/** One row in the Schedule list — a visit or a meeting, normalized to a common shape. */
export type ScheduleItem =
  | {
      kind: 'visit'
      id: string
      title: string
      startTime: Date
      endTime: Date
      timezone: string
      status: MyVisit['status']
    }
  | {
      kind: 'meeting'
      id: string
      title: string
      startTime: Date
      endTime: Date
      timezone: string
      meetingUrl: MyMeeting['meetingUrl']
    }

/** One sticky-header day section — `dayKey` is `yyyy-MM-dd`, stable for scroll targeting. */
export interface ScheduleDayGroup {
  dayKey: string
  date: Date
  items: ScheduleItem[]
}

/**
 * Merge + group the signed-in user's visits and meetings for the Schedule page. Window is a
 * simple fixed ±4 weeks around "now" for v1 (08 §2 — "extendable as the user navigates" is
 * parked past v1). Realtime: any `dispatch:visit-changed` broadcast on the org channel
 * invalidates the visit window query — meetings have no live-broadcast source yet.
 */
export function useMySchedule() {
  const { from, to } = useMemo(() => {
    const now = new Date()
    return { from: startOfDay(addWeeks(now, -4)), to: startOfDay(addWeeks(now, 4)) }
  }, [])

  const visitsQuery = api.dispatch.myVisits.useQuery({ from, to })
  const meetingsQuery = api.calendar.myMeetings.useQuery({ from, to })

  const utils = api.useUtils()
  const queryClient = useQueryClient()
  const viewerWorkerIds = useViewerWorkerIds()

  // Plan 39 §Phase-2: a `kind: 'row'` broadcast rewraps its wire-string dates and patches every
  // cached `myVisits` window via `applyVisitToCaches` (scoped internally to `viewerWorkerIds`)
  // instead of invalidating. `kind: 'bulk'` and any old-shape/malformed payload fall back to the
  // pre-Phase-2 scoped invalidate.
  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dispatch:visit-changed') return
      const p = payload as VisitChangedPayload | undefined
      if (p?.kind === 'row' && p.visit && viewerWorkerIds.length > 0) {
        applyVisitToCaches(
          { utils, queryClient },
          {
            visit: rewrapVisitDates(p.visit),
            workOrderStatus: p.workOrderStatus,
            viewerWorkerIds,
          }
        )
        return
      }
      void utils.dispatch.myVisits.invalidate({ from, to })
    },
    [utils, queryClient, viewerWorkerIds, from, to]
  )
  useOrgChannel({ onEvent })

  const groups = useMemo<ScheduleDayGroup[]>(() => {
    const items: ScheduleItem[] = [
      ...(visitsQuery.data ?? []).map(
        (visit): ScheduleItem => ({
          kind: 'visit',
          id: visit.id,
          title: visitTitle(visit),
          startTime: visit.startTime,
          endTime: visit.endTime,
          timezone: visit.timezone,
          status: visit.status,
        })
      ),
      ...(meetingsQuery.data ?? []).map(
        (meeting): ScheduleItem => ({
          kind: 'meeting',
          id: meeting.id,
          title: meeting.title,
          startTime: meeting.startTime,
          endTime: meeting.endTime,
          timezone: meeting.timezone,
          meetingUrl: meeting.meetingUrl,
        })
      ),
    ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

    const byDay = new Map<string, ScheduleItem[]>()
    for (const item of items) {
      const dayKey = format(item.startTime, 'yyyy-MM-dd')
      const list = byDay.get(dayKey)
      if (list) list.push(item)
      else byDay.set(dayKey, [item])
    }

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, dayItems]) => ({ dayKey, date: dayItems[0]!.startTime, items: dayItems }))
  }, [visitsQuery.data, meetingsQuery.data])

  const todayIndex = useMemo(() => {
    if (groups.length === 0) return 0
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    const index = groups.findIndex((group) => group.dayKey >= todayKey)
    return index === -1 ? groups.length - 1 : index
  }, [groups])

  return {
    groups,
    todayIndex,
    isLoading: visitsQuery.isLoading || meetingsQuery.isLoading,
    isError: visitsQuery.isError || meetingsQuery.isError,
  }
}

// apps/web/src/components/dispatch/ui/board/hooks/use-availability-shading.ts

'use client'

import type { BackgroundEvent } from '@auxx/ui/components/event-calendar'
import { format } from 'date-fns'
import { useCallback, useEffect, useMemo } from 'react'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import {
  type AvailabilitySubject,
  availabilitySubjectKey,
  useAvailabilityCacheStore,
} from '../../../stores/availability-cache-store'
import { useResolvedDaysForSubjects } from '../../../stores/use-resolved-days'
import type { DateRange as IsoRange } from '../../../utils/date-ranges'
import type { BoardViewMode } from '../types'
import { UNASSIGNED_RESOURCE_ID } from '../types'
import { offHoursBackgroundEvents } from '../utils'
import type { DateRange } from './use-board-data'

const ORG_KEY = availabilitySubjectKey({ type: 'organization' })
const workerKey = (userId: string) => availabilitySubjectKey({ type: 'worker', userId })
/**
 * Availability shading (07 §D.2 · 12-availability-cache.md), redesigned onto a client cache: instead
 * of re-querying `availability.resolve` for each visible window, we fetch the deterministic
 * `fetchWindow` (padded ±1 month/week, owned by `useBoardData`), record what's loaded in
 * `useAvailabilityCacheStore`, and fetch only the not-yet-loaded gaps — so a month already shown
 * never re-fetches, and the fetch no longer chases the calendar's noisy visible-range echo (which
 * churns on scroll/re-measure). `range` is the VISIBLE window and drives painting only. Non-working
 * days paint immediately from the persisted org weekly-working-days baseline, then refine as resolved
 * (exception-aware) days stream in. Day mode shades each worker column from its own schedule + the
 * Unassigned column from org hours; week mode shades org-wide; month tints non-working days via
 * `isNonWorkingDay`. Hints only — never gates a drop.
 */
export function useAvailabilityShading({
  view,
  range,
  fetchWindow: fetchWindowRange,
  workerUserIds,
}: {
  view: BoardViewMode
  range: DateRange
  fetchWindow: DateRange
  workerUserIds: string[]
}): {
  backgroundEvents: BackgroundEvent[]
  isNonWorkingDay: (date: Date) => boolean
} {
  const subjects = useAvailabilityCacheStore((s) => s.subjects)
  const setWeeklyWorkingDays = useAvailabilityCacheStore((s) => s.setWeeklyWorkingDays)

  // Instant baseline — the org's weekly working-days (persisted; drives `isNonWorkingDay` before any
  // resolve returns). Cached by React Query; we mirror it into the store on every result.
  const orgWeekly = api.availability.getWeeklyHours.useQuery(
    { subject: { type: 'organization' } },
    { staleTime: ORG_STATIC_STALE_TIME }
  )
  useEffect(() => {
    if (orgWeekly.data === undefined) return
    setWeeklyWorkingDays(
      ORG_KEY,
      (orgWeekly.data?.days ?? []).map((d) => d.dayOfWeek)
    )
  }, [orgWeekly.data, setWeeklyWorkingDays])

  // The board's deterministic fetch window (padded ±1 month/week in `useBoardData`), as ISO strings
  // for the day-granular cache. Only changes when the settled month/week does, so the gap-only
  // fetch runs once per window instead of re-firing on every scroll-frame range echo.
  const fetchWindow = useMemo<IsoRange>(
    () => ({
      from: format(fetchWindowRange.from, 'yyyy-MM-dd'),
      to: format(fetchWindowRange.to, 'yyyy-MM-dd'),
    }),
    [fetchWindowRange.from, fetchWindowRange.to]
  )

  // Subjects to cover: org always; each visible worker in day view.
  const subjectList = useMemo<Array<{ key: string; subject: AvailabilitySubject }>>(() => {
    const list: Array<{ key: string; subject: AvailabilitySubject }> = [
      { key: ORG_KEY, subject: { type: 'organization' } },
    ]
    if (view === 'day' || view === 'timeline') {
      for (const userId of workerUserIds) {
        list.push({
          key: workerKey(userId),
          subject: { type: 'worker', userId },
        })
      }
    }
    return list
  }, [view, workerUserIds])

  useResolvedDaysForSubjects(
    subjectList.map(({ subject }) => subject),
    fetchWindow.from,
    fetchWindow.to
  )

  // Shading reads from the cache for the VISIBLE range (the calendar filters bands per day anyway).
  const fromIso = format(range.from, 'yyyy-MM-dd')
  const toIso = format(range.to, 'yyyy-MM-dd')
  const visibleDays = useCallback(
    (key: string) => {
      const days = subjects[key]?.days
      if (!days) return []
      return Object.values(days).filter((d) => d.date >= fromIso && d.date <= toIso)
    },
    [subjects, fromIso, toIso]
  )

  const backgroundEvents = useMemo(() => {
    if (view === 'day' || view === 'timeline') {
      const events = workerUserIds.flatMap((userId) =>
        visibleDays(workerKey(userId)).flatMap((day) =>
          offHoursBackgroundEvents(new Date(`${day.date}T00:00:00`), day.ranges, userId)
        )
      )
      const unassigned = visibleDays(ORG_KEY).flatMap((day) =>
        offHoursBackgroundEvents(
          new Date(`${day.date}T00:00:00`),
          day.ranges,
          UNASSIGNED_RESOURCE_ID
        )
      )
      return [...events, ...unassigned]
    }
    if (view === 'week') {
      return visibleDays(ORG_KEY).flatMap((day) =>
        offHoursBackgroundEvents(new Date(`${day.date}T00:00:00`), day.ranges)
      )
    }
    return []
  }, [view, workerUserIds, visibleDays])

  // Non-working-day tint (month view): a resolved day wins (exception-aware); otherwise fall back to
  // the weekly baseline so weekends paint from the get-go. `getDay()` is 0=Sun, matching the server.
  const orgCache = subjects[ORG_KEY]
  const isNonWorkingDay = useCallback(
    (date: Date) => {
      const cached = orgCache?.days[format(date, 'yyyy-MM-dd')]
      if (cached) return cached.ranges.length === 0
      const weekly = orgCache?.weeklyWorkingDays
      if (weekly != null) return !weekly.includes(date.getDay())
      return false
    },
    [orgCache]
  )

  return { backgroundEvents, isNonWorkingDay }
}

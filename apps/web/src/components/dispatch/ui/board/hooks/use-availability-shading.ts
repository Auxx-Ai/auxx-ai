// apps/web/src/components/dispatch/ui/board/hooks/use-availability-shading.ts

'use client'

import type { BackgroundEvent } from '@auxx/ui/components/event-calendar'
import {
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
  subWeeks,
} from 'date-fns'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type AvailabilitySubject,
  availabilitySubjectKey,
  useAvailabilityCacheStore,
} from '~/stores/availability-cache-store'
import { chunkRange, type DateRange as IsoRange, subtractRanges } from '~/stores/date-ranges'
import { api } from '~/trpc/react'
import type { BoardViewMode } from '../types'
import { UNASSIGNED_RESOURCE_ID } from '../types'
import { offHoursBackgroundEvents } from '../utils'
import type { DateRange } from './use-board-data'

const ORG_KEY = availabilitySubjectKey({ type: 'organization' })
const workerKey = (userId: string) => availabilitySubjectKey({ type: 'worker', userId })
/** `availability.resolve` hard-caps at 366 days; chunk well under it. */
const MAX_FETCH_DAYS = 180

/**
 * Availability shading (07 §D.2 · 12-availability-cache.md), redesigned onto a client cache: instead
 * of re-querying `availability.resolve` for each visible window, we over-fetch a 3-month window,
 * record what's loaded in `useAvailabilityCacheStore`, and fetch only the not-yet-loaded gaps — so a
 * month already shown never re-fetches. Non-working days paint immediately from the persisted org
 * weekly-working-days baseline, then refine as resolved (exception-aware) days stream in. Day mode
 * shades each worker column from its own schedule + the Unassigned column from org hours; week mode
 * shades org-wide; month tints non-working days via `isNonWorkingDay`. Hints only — never gates a drop.
 */
export function useAvailabilityShading({
  view,
  range,
  workerUserIds,
}: {
  view: BoardViewMode
  range: DateRange
  workerUserIds: string[]
}): { backgroundEvents: BackgroundEvent[]; isNonWorkingDay: (date: Date) => boolean } {
  const utils = api.useUtils()
  const subjects = useAvailabilityCacheStore((s) => s.subjects)
  const ingestResolved = useAvailabilityCacheStore((s) => s.ingestResolved)
  const setWeeklyWorkingDays = useAvailabilityCacheStore((s) => s.setWeeklyWorkingDays)

  // Instant baseline — the org's weekly working-days (persisted; drives `isNonWorkingDay` before any
  // resolve returns). Cached by React Query; we mirror it into the store on every result.
  const orgWeekly = api.availability.getWeeklyHours.useQuery({ subject: { type: 'organization' } })
  useEffect(() => {
    if (orgWeekly.data === undefined) return
    setWeeklyWorkingDays(
      ORG_KEY,
      (orgWeekly.data?.days ?? []).map((d) => d.dayOfWeek)
    )
  }, [orgWeekly.data, setWeeklyWorkingDays])

  // 3-month over-fetch window (±1 month around the visible month; ±1 week for day/week) — covers the
  // month grid's leading/trailing spill days AND adjacent-month scroll in one cache-tracked fetch.
  const fetchWindow = useMemo<IsoRange>(() => {
    const from = view === 'month' ? startOfMonth(subMonths(range.from, 1)) : subWeeks(range.from, 1)
    const to = view === 'month' ? endOfMonth(addMonths(range.to, 1)) : addWeeks(range.to, 1)
    return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') }
  }, [view, range.from, range.to])

  // Subjects to cover: org always; each visible worker in day view.
  const subjectList = useMemo<Array<{ key: string; subject: AvailabilitySubject }>>(() => {
    const list: Array<{ key: string; subject: AvailabilitySubject }> = [
      { key: ORG_KEY, subject: { type: 'organization' } },
    ]
    if (view === 'day') {
      for (const userId of workerUserIds) {
        list.push({ key: workerKey(userId), subject: { type: 'worker', userId } })
      }
    }
    return list
  }, [view, workerUserIds])

  // Gap-only fetch: for each subject, resolve only the parts of `fetchWindow` not already loaded.
  const inFlight = useRef(new Set<string>())
  useEffect(() => {
    for (const { key, subject } of subjectList) {
      const loaded = subjects[key]?.loadedRanges ?? []
      const gaps = subtractRanges(fetchWindow, loaded).flatMap((g) => chunkRange(g, MAX_FETCH_DAYS))
      for (const gap of gaps) {
        const tag = `${key}:${gap.from}:${gap.to}`
        if (inFlight.current.has(tag)) continue
        inFlight.current.add(tag)
        utils.availability.resolve
          .fetch({ subject, from: gap.from, to: gap.to })
          .then((days) => ingestResolved(key, gap, days))
          .catch(() => {})
          .finally(() => inFlight.current.delete(tag))
      }
    }
  }, [subjectList, fetchWindow, subjects, utils, ingestResolved])

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
    if (view === 'day') {
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

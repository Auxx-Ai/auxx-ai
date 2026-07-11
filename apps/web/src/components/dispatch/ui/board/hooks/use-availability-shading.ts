// apps/web/src/components/dispatch/ui/board/hooks/use-availability-shading.ts

'use client'

import type { BackgroundEvent } from '@auxx/ui/components/event-calendar'
import { format } from 'date-fns'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { BoardViewMode } from '../types'
import { offHoursBackgroundEvents } from '../utils'
import type { DateRange } from './use-board-data'

/**
 * Availability shading (07 §D.2, 05-availability.md's `resolveAvailability`): off-hours +
 * time-off, rendered via the calendar's `backgroundEvents` layer. Day (resource) mode shades
 * each worker column from its own resolved schedule (which already falls back to org hours
 * per the precedence rule — 05 §resolve.ts); week mode shades every day org-wide (no
 * per-resource columns to differentiate); month tints fully-closed days via
 * `isNonWorkingDay` (the stream has no intra-day axis to shade). Hints only — never
 * gates a drop.
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
  const fromIso = format(range.from, 'yyyy-MM-dd')
  const toIso = format(range.to, 'yyyy-MM-dd')

  const dayResults = api.useQueries((t) =>
    view === 'day'
      ? workerUserIds.map((userId) =>
          t.availability.resolve({ subject: { type: 'worker', userId }, from: fromIso, to: toIso })
        )
      : []
  )

  const orgResult = api.availability.resolve.useQuery(
    { subject: { type: 'organization' }, from: fromIso, to: toIso },
    { enabled: view === 'week' || view === 'month' }
  )

  const backgroundEvents = useMemo(() => {
    if (view === 'day') {
      return workerUserIds.flatMap((userId, index) => {
        const resolvedDays = dayResults[index]?.data ?? []
        return resolvedDays.flatMap((day) =>
          offHoursBackgroundEvents(new Date(`${day.date}T00:00:00`), day.ranges, userId)
        )
      })
    }
    if (view === 'week') {
      const resolvedDays = orgResult.data ?? []
      return resolvedDays.flatMap((day) =>
        offHoursBackgroundEvents(new Date(`${day.date}T00:00:00`), day.ranges)
      )
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, workerUserIds, dayResults, orgResult.data])

  // Org-wide fully-closed dates (no available ranges at all) — the month stream's gray days.
  const closedDates = useMemo(() => {
    const closed = new Set<string>()
    for (const day of orgResult.data ?? []) {
      if (day.ranges.length === 0) closed.add(day.date)
    }
    return closed
  }, [orgResult.data])

  const isNonWorkingDay = useCallback(
    (date: Date) => closedDates.has(format(date, 'yyyy-MM-dd')),
    [closedDates]
  )

  return { backgroundEvents, isNonWorkingDay }
}

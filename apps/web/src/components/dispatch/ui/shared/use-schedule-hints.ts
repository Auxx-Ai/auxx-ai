// apps/web/src/components/dispatch/ui/shared/use-schedule-hints.ts

import { format } from 'date-fns'
import { useMemo } from 'react'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useResolvedDays } from '../../stores/use-resolved-days'
import type { ExistingVisitForOverlap } from '../schedule-popover'

export interface UseScheduleHintsParams {
  /** Excluded from the overlap check (the visit's own slot isn't a conflict). Undefined in the
   * schedule popover's CREATE mode — nothing exists yet, so nothing to exclude. */
  visitId?: string
  assigneeWorkerId: string | null
  startTime: Date | null | undefined
  endTime: Date | null | undefined
  existingVisits: ExistingVisitForOverlap[]
}

/**
 * Availability + overlap amber hints (extracted verbatim from `schedule-popover.tsx:246-281`) —
 * off-day, outside-working-hours, and same-day overlap against another visit assigned to the
 * same worker. Feeds the base `EventPopoverHints` slot for both the board and converged
 * schedule popovers (consequence of decision #9).
 *
 * Availability shading is inherently per-USER (`AvailabilitySubject` is `{type:'worker',userId}`,
 * keyed to a real person's schedule), so an individual assignee resolves its worker row → the
 * backing `userId`. Teams skip shading entirely (45-teams.md §1.F — "always render schedulable",
 * no member-hours intersection in v1); the overlap check below stays worker-keyed either way.
 */
export function useScheduleHints({
  visitId,
  assigneeWorkerId,
  startTime,
  endTime,
  existingVisits,
}: UseScheduleHintsParams): string[] {
  const workersQuery = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const assigneeWorker = workersQuery.data?.find((w) => w.id === assigneeWorkerId)
  const availabilityUserId =
    assigneeWorker?.type === 'individual' ? (assigneeWorker.userId ?? null) : null

  const dayIso = startTime ? format(startTime, 'yyyy-MM-dd') : undefined
  const resolvedDays = useResolvedDays(
    availabilityUserId && dayIso ? { type: 'worker', userId: availabilityUserId } : null,
    dayIso,
    dayIso
  )

  return useMemo(() => {
    const list: string[] = []
    const resolvedDay = resolvedDays[0]
    if (resolvedDay) {
      if (resolvedDay.ranges.length === 0) {
        list.push('Off that day')
      } else if (startTime && endTime) {
        const startMin = startTime.getHours() * 60 + startTime.getMinutes()
        const endMin = endTime.getHours() * 60 + endTime.getMinutes()
        const withinAnyRange = resolvedDay.ranges.some(
          (r) => startMin >= r.start && endMin <= r.end
        )
        if (!withinAnyRange) list.push('Outside working hours')
      }
    }
    if (assigneeWorkerId && startTime && endTime) {
      for (const visit of existingVisits) {
        if (visit.id === visitId) continue
        if (visit.assigneeWorkerId !== assigneeWorkerId) continue
        if (startTime < visit.endTime && visit.startTime < endTime) {
          list.push(`Overlaps ${visit.label}`)
        }
      }
    }
    return list
  }, [resolvedDays, startTime, endTime, assigneeWorkerId, existingVisits, visitId])
}

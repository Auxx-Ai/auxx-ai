// apps/web/src/components/dispatch/ui/shared/use-schedule-hints.ts

import { format } from 'date-fns'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import type { ExistingVisitForOverlap } from '../schedule-popover'

export interface UseScheduleHintsParams {
  visitId: string
  assigneeUserId: string | null
  startTime: Date | null | undefined
  endTime: Date | null | undefined
  existingVisits: ExistingVisitForOverlap[]
}

/**
 * Availability + overlap amber hints (extracted verbatim from `schedule-popover.tsx:246-281`) —
 * off-day, outside-working-hours, and same-day overlap against another visit assigned to the
 * same worker. Feeds the base `EventPopoverHints` slot for both the board and converged
 * schedule popovers (consequence of decision #9).
 */
export function useScheduleHints({
  visitId,
  assigneeUserId,
  startTime,
  endTime,
  existingVisits,
}: UseScheduleHintsParams): string[] {
  const dayIso = startTime ? format(startTime, 'yyyy-MM-dd') : undefined
  const availabilityQuery = api.availability.resolve.useQuery(
    {
      subject: { type: 'worker', userId: assigneeUserId ?? '' },
      from: dayIso ?? '',
      to: dayIso ?? '',
    },
    { enabled: Boolean(assigneeUserId && dayIso) }
  )

  return useMemo(() => {
    const list: string[] = []
    const resolvedDay = availabilityQuery.data?.[0]
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
    if (assigneeUserId && startTime && endTime) {
      for (const visit of existingVisits) {
        if (visit.id === visitId) continue
        if (visit.assigneeUserId !== assigneeUserId) continue
        if (startTime < visit.endTime && visit.startTime < endTime) {
          list.push(`Overlaps ${visit.label}`)
        }
      }
    }
    return list
  }, [availabilityQuery.data, startTime, endTime, assigneeUserId, existingVisits, visitId])
}

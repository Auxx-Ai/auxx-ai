// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-utils.ts

import type { Variant } from '@auxx/ui/components/badge'
import { format } from 'date-fns'
import type { JobVisit } from './use-job-visits'

/** Badge tone per visit status — mirrors `WORK_ORDER_STATUS_OPTIONS`' color choices. */
export const VISIT_STATUS_BADGE_VARIANT: Record<string, Variant> = {
  scheduled: 'blue',
  en_route: 'amber',
  on_site: 'teal',
  done: 'green',
  canceled: 'red',
}

/**
 * `EEE, MMM d · p – p` (or "Not scheduled" for a backlog row) — the visit row title.
 *
 * `timeConfirmedAt` is optional so callers passing a narrower slice still compile; when it's
 * present and `null` on a scheduled visit, the time is provisional (planner math, never
 * promised to a human — plan 20 §4.2/§4.3) and gets a `~` prefix.
 */
export function formatVisitWindow(
  visit: Pick<JobVisit, 'startTime' | 'endTime'> & { timeConfirmedAt?: JobVisit['timeConfirmedAt'] }
): string {
  if (!visit.startTime) return 'Not scheduled'
  const provisional = 'timeConfirmedAt' in visit && visit.timeConfirmedAt == null
  const start = new Date(visit.startTime)
  const startLabel = `${provisional ? '~' : ''}${format(start, 'EEE, MMM d · p')}`
  if (!visit.endTime) return startLabel
  const end = new Date(visit.endTime)
  return `${startLabel} – ${format(end, 'p')}`
}

/**
 * Client mirror of `resolveVisitDurationMinutes` (`packages/lib/src/dispatch/types.ts` — no
 * `/client` export subpath, server-only deps elsewhere in that module, so this is duplicated
 * per the `board/types.ts` mirror convention; do not edit the source, keep this in sync with
 * it). Read-order for a visit's on-site duration (plan 20 §4.1a): explicit `durationMinutes` →
 * scheduled span → 60.
 */
export function resolveVisitDurationMinutes(visit: {
  durationMinutes?: number | null
  startTime?: Date | string | null
  endTime?: Date | string | null
}): number {
  if (visit.durationMinutes != null) return visit.durationMinutes
  if (visit.startTime && visit.endTime) {
    const start = new Date(visit.startTime).getTime()
    const end = new Date(visit.endTime).getTime()
    const spanMinutes = Math.round((end - start) / 60_000)
    if (spanMinutes > 0) return spanMinutes
  }
  return 60
}

/** Visits that already ran their course — done/canceled, or a past scheduled window. */
export function isPastVisit(visit: Pick<JobVisit, 'status' | 'endTime'>): boolean {
  if (visit.status === 'done' || visit.status === 'canceled') return true
  if (!visit.endTime) return false
  return new Date(visit.endTime).getTime() < Date.now()
}

/** Newest-first split of a work order's visits into "upcoming" and "history" (07 §F.3). */
export function splitJobVisits(visits: JobVisit[]): { upcoming: JobVisit[]; history: JobVisit[] } {
  const upcoming: JobVisit[] = []
  const history: JobVisit[] = []
  for (const visit of visits) {
    if (isPastVisit(visit)) history.push(visit)
    else upcoming.push(visit)
  }
  // listVisitsForWorkOrder orders oldest-scheduled-first; history reads newest-first (§F.3).
  history.reverse()
  return { upcoming, history }
}

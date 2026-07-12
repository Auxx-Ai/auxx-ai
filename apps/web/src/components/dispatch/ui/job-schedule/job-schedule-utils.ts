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

/** Plain-text tone per visit status — the 04 mock's right-aligned status column. */
export const VISIT_STATUS_TEXT_CLASS: Record<string, string> = {
  scheduled: 'text-blue-600 dark:text-blue-400',
  en_route: 'text-amber-600 dark:text-amber-400',
  on_site: 'text-teal-600 dark:text-teal-400',
  done: 'text-green-600 dark:text-green-400',
  canceled: 'text-red-600 dark:text-red-400',
}

/** `EEE, MMM d` (or "Not scheduled") — the grid row's date column. */
export function formatVisitDate(visit: Pick<JobVisit, 'startTime'>): string {
  if (!visit.startTime) return 'Not scheduled'
  return format(new Date(visit.startTime), 'EEE, MMM d')
}

/** `p – p` (or empty when unscheduled) — the grid row's time column. */
export function formatVisitTime(visit: Pick<JobVisit, 'startTime' | 'endTime'>): string {
  if (!visit.startTime) return ''
  const startLabel = format(new Date(visit.startTime), 'p')
  if (!visit.endTime) return startLabel
  return `${startLabel} – ${format(new Date(visit.endTime), 'p')}`
}

/** `EEE, MMM d · p – p` (or "Not scheduled" for a backlog row) — the visit row title. */
export function formatVisitWindow(visit: Pick<JobVisit, 'startTime' | 'endTime'>): string {
  if (!visit.startTime) return 'Not scheduled'
  const start = new Date(visit.startTime)
  const startLabel = format(start, 'EEE, MMM d · p')
  if (!visit.endTime) return startLabel
  const end = new Date(visit.endTime)
  return `${startLabel} – ${format(end, 'p')}`
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

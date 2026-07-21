// apps/web/src/components/dispatch/ui/job-schedule/job-schedule-utils.ts

import type { Variant } from '@auxx/ui/components/badge'
import { format, startOfDay } from 'date-fns'
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

/**
 * Whether the Dispatch (notify-worker) action should be offered for a visit (plan 30 §C):
 * status must be `scheduled` and the start must land today or tomorrow in the visit's own
 * timezone (stamped from the org clock at scheduling — decision §C/5; the server guard in
 * `dispatchVisit` is authoritative, this only gates the affordance). `Intl` is used directly
 * so no tz library enters the client bundle.
 */
export function isVisitDispatchable(visit: {
  status?: string | null
  startTime?: Date | string | null
  timezone?: string | null
}): boolean {
  if (visit.status !== 'scheduled' || !visit.startTime) return false
  const dayKey = (date: Date): string => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: visit.timezone ?? undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date)
    } catch {
      return format(date, 'yyyy-MM-dd')
    }
  }
  const startKey = dayKey(new Date(visit.startTime))
  const now = new Date()
  return startKey === dayKey(now) || startKey === dayKey(new Date(now.getTime() + 86_400_000))
}

/**
 * Visits that already ran their course — done/canceled, or a scheduled window that ended on
 * an earlier day. A scheduled visit stays in "upcoming" for the whole of its day: it only
 * drops into history once its end lands before the start of today, so a visit earlier today
 * (already elapsed by the clock) is still shown as scheduled rather than filed away.
 */
export function isPastVisit(visit: Pick<JobVisit, 'status' | 'endTime'>): boolean {
  if (visit.status === 'done' || visit.status === 'canceled') return true
  if (!visit.endTime) return false
  return new Date(visit.endTime).getTime() < startOfDay(new Date()).getTime()
}

/**
 * "Moved from Fri, Jul 4" secondary line for a detached visit whose scheduled local day no
 * longer matches its original `occurrenceDate` (plan 30 §D.3 — holiday-move presentation, no
 * engine change). `occurrenceDate` is a plain `YYYY-MM-DD` date string — parsed as a LOCAL date
 * (not `new Date('YYYY-MM-DD')`, which is UTC) so the day comparison lines up with `startTime`'s
 * local day. Returns `null` when the visit isn't detached, has no `startTime`, or the days match.
 */
export function movedFromLabel(
  visit: Pick<JobVisit, 'isDetached' | 'occurrenceDate' | 'startTime'>
): string | null {
  if (!visit.isDetached || !visit.occurrenceDate || !visit.startTime) return null
  const [year, month, day] = visit.occurrenceDate.split('-').map(Number)
  if (!year || !month || !day) return null
  const occurrence = new Date(year, month - 1, day)
  const start = new Date(visit.startTime)
  const sameDay =
    occurrence.getFullYear() === start.getFullYear() &&
    occurrence.getMonth() === start.getMonth() &&
    occurrence.getDate() === start.getDate()
  if (sameDay) return null
  return `Moved from ${format(occurrence, 'EEE, MMM d')}`
}

/**
 * Confirm-dialog copy for the cancel/skip action — ONE source for the board popover and every
 * job-schedule surface. Series rows offer the extra "Skip this and future visits" choice
 * (`alternateText` resolves `'alternate'` from `useConfirm`), which routes to
 * `dispatch.cancelVisitFollowing` (tombstone + series ends at this occurrence).
 */
export function cancelVisitConfirmOptions(isSeries: boolean) {
  return isSeries
    ? {
        title: 'Skip this visit?',
        description:
          'The visit stays in the job\'s history as skipped and won\'t be regenerated. "Skip this and future visits" also ends the series after this one — you can restore the last skipped visit or extend the series later.',
        confirmText: 'Skip visit',
        alternateText: 'Skip this and future visits',
        cancelText: 'Keep visit',
        destructive: true,
      }
    : {
        title: 'Cancel this visit?',
        description:
          "The visit stays in the job's history as canceled. This does not cancel the job.",
        confirmText: 'Cancel visit',
        cancelText: 'Keep visit',
        destructive: true,
      }
}

/**
 * Confirm-dialog copy for restoring the series BOUNDARY visit — the skipped occurrence a
 * "Skip this and future visits" ended the series at (plan 36 §B.1). Mirrors the skip dialog's
 * two-choice shape: primary restores the visit in place (it stays the series' final
 * occurrence), `alternateText` resolves `'alternate'` → `restoreVisit` with
 * `resumeSeries: true` (clears the end date, regenerates the tail). Non-boundary skipped
 * rows restore directly, no dialog.
 */
export function restoreSeriesBoundaryConfirmOptions() {
  return {
    title: 'Restore this visit?',
    description:
      'This visit is where the series ends. "Restore and resume future visits" also removes the end date and regenerates future visits from the schedule — customized visits removed by the skip are not restored.',
    confirmText: 'Restore visit',
    alternateText: 'Restore and resume future visits',
    cancelText: 'Keep skipped',
  }
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

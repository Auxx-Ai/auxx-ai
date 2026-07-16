// packages/lib/src/availability/resolve.ts
//
// Resolve subjects' effective schedules for a date range (05-availability.md §A.2, and
// 01-data-model.md §4.1's precedence rule). Precedence, per date:
//   1. the subject's own exception rows for that date
//   2. org-level exception rows for that date (org exceptions apply to every subject)
//   3. the subject's own weekly rows for that weekday
//   4. the org's weekly rows for that weekday — fallback ONLY when the subject has ZERO
//      weekly rows overall (not per-day; e.g. an inheriting worker)
//
// Batched (plans/dispatch/25-availability-resolve-batching.md): all subjects share one
// organization, so the org rows (needed both when the org is itself a subject and as every
// worker/widget's fallback) are fetched ONCE, and all non-org subjects' rows come back in one
// `inArray` query per kind — a constant 4 queries regardless of subject count.

import { database, schema } from '@auxx/database'
import { and, eq, gte, inArray, lte, or, type SQL } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { dayOfWeekFromDate, enumerateDates } from './dates'
import { groupExceptionRowsByDate } from './exceptions'
import { subjectConditions } from './subject'
import type { AvailabilitySubject, ResolvedDay } from './types'
import { groupWeeklyRowsByDay } from './weekly-hours'

type OperatingHoursRow = typeof schema.OperatingHours.$inferSelect

/** Grouping key matching a fetched row back to its subject. */
function subjectKey(subject: AvailabilitySubject): string {
  switch (subject.type) {
    case 'organization':
      return 'org'
    case 'worker':
      return `w:${subject.userId}`
    case 'widget':
      return `wg:${subject.widgetId}`
  }
}

function rowKey(row: OperatingHoursRow): string {
  if (row.subjectType === 'worker') return `w:${row.userId}`
  if (row.subjectType === 'widget') return `wg:${row.widgetId}`
  return 'org'
}

function groupByKey(rows: OperatingHoursRow[]): Map<string, OperatingHoursRow[]> {
  const byKey = new Map<string, OperatingHoursRow[]>()
  for (const row of rows) {
    const key = rowKey(row)
    const list = byKey.get(key)
    if (list) list.push(row)
    else byKey.set(key, [row])
  }
  return byKey
}

/**
 * Effective ranges for every date in `[range.from, range.to]` (inclusive, capped at 366 days)
 * for EACH subject — the result array is index-aligned with `subjects`. All subjects must
 * belong to the same organization.
 */
export async function resolveAvailabilityForSubjects(
  subjects: AvailabilitySubject[],
  range: { from: string; to: string }
): Promise<ResolvedDay[][]> {
  if (subjects.length === 0) return []
  const organizationId = subjects[0]!.organizationId
  if (subjects.some((s) => s.organizationId !== organizationId)) {
    throw new BadRequestError('All subjects in a batch must belong to the same organization')
  }

  const dates = enumerateDates(range.from, range.to)
  const orgSubject: AvailabilitySubject = { type: 'organization', organizationId }

  const workerIds = [...new Set(subjects.flatMap((s) => (s.type === 'worker' ? [s.userId] : [])))]
  const widgetIds = [...new Set(subjects.flatMap((s) => (s.type === 'widget' ? [s.widgetId] : [])))]

  const nonOrgPredicates: SQL[] = []
  if (workerIds.length > 0) {
    nonOrgPredicates.push(
      and(
        eq(schema.OperatingHours.subjectType, 'worker'),
        inArray(schema.OperatingHours.userId, workerIds)
      )!
    )
  }
  if (widgetIds.length > 0) {
    nonOrgPredicates.push(
      and(
        eq(schema.OperatingHours.subjectType, 'widget'),
        inArray(schema.OperatingHours.widgetId, widgetIds)
      )!
    )
  }
  const nonOrgConditions =
    nonOrgPredicates.length > 0
      ? and(eq(schema.OperatingHours.organizationId, organizationId), or(...nonOrgPredicates))!
      : null

  const dateBounds = and(
    gte(schema.OperatingHours.date, range.from),
    lte(schema.OperatingHours.date, range.to)
  )!

  const [orgExceptionRows, orgWeeklyRows, nonOrgExceptionRows, nonOrgWeeklyRows] =
    await Promise.all([
      database.query.OperatingHours.findMany({
        where: and(
          subjectConditions(orgSubject),
          eq(schema.OperatingHours.kind, 'exception'),
          dateBounds
        ),
      }),
      database.query.OperatingHours.findMany({
        where: and(subjectConditions(orgSubject), eq(schema.OperatingHours.kind, 'weekly')),
      }),
      nonOrgConditions
        ? database.query.OperatingHours.findMany({
            where: and(nonOrgConditions, eq(schema.OperatingHours.kind, 'exception'), dateBounds),
          })
        : Promise.resolve([]),
      nonOrgConditions
        ? database.query.OperatingHours.findMany({
            where: and(nonOrgConditions, eq(schema.OperatingHours.kind, 'weekly')),
          })
        : Promise.resolve([]),
    ])

  const nonOrgExceptionsByKey = groupByKey(nonOrgExceptionRows)
  const nonOrgWeeklyByKey = groupByKey(nonOrgWeeklyRows)

  const orgExceptionsByDate = groupExceptionRowsByDate(orgExceptionRows)
  const orgWeeklyByDay = groupWeeklyRowsByDay(orgWeeklyRows)
  const orgTimezone = orgWeeklyRows[0]?.timezone ?? 'UTC'

  return subjects.map((subject): ResolvedDay[] => {
    const isOrg = subject.type === 'organization'
    const key = subjectKey(subject)
    const subjectExceptionRows = isOrg ? orgExceptionRows : (nonOrgExceptionsByKey.get(key) ?? [])
    const subjectWeeklyRows = isOrg ? orgWeeklyRows : (nonOrgWeeklyByKey.get(key) ?? [])

    const subjectExceptionsByDate = isOrg
      ? orgExceptionsByDate
      : groupExceptionRowsByDate(subjectExceptionRows)
    const subjectWeeklyByDay = isOrg ? orgWeeklyByDay : groupWeeklyRowsByDay(subjectWeeklyRows)
    const subjectHasWeekly = subjectWeeklyRows.length > 0
    const subjectTimezone = subjectWeeklyRows[0]?.timezone ?? 'UTC'

    // The org fallback applies to non-org subjects only — an org subject's own rows ARE the
    // org rows, and its misses resolve to closed (empty ranges), never back onto itself.
    const fallbackExceptionsByDate = isOrg ? undefined : orgExceptionsByDate
    const fallbackWeeklyByDay = isOrg ? undefined : orgWeeklyByDay
    const fallbackTimezone = isOrg ? 'UTC' : orgTimezone

    return dates.map((date): ResolvedDay => {
      const subjectException = subjectExceptionsByDate.get(date)
      if (subjectException) {
        return { date, ranges: subjectException.ranges, timezone: subjectException.timezone }
      }

      const orgException = fallbackExceptionsByDate?.get(date)
      if (orgException) {
        return { date, ranges: orgException.ranges, timezone: orgException.timezone }
      }

      const dayOfWeek = dayOfWeekFromDate(date)

      if (subjectHasWeekly) {
        const day = subjectWeeklyByDay.get(dayOfWeek)
        return { date, ranges: day?.ranges ?? [], timezone: day?.timezone ?? subjectTimezone }
      }

      const orgDay = fallbackWeeklyByDay?.get(dayOfWeek)
      return { date, ranges: orgDay?.ranges ?? [], timezone: orgDay?.timezone ?? fallbackTimezone }
    })
  })
}

/** Effective ranges for a single subject — thin wrapper over the batched resolver. */
export async function resolveAvailability(
  subject: AvailabilitySubject,
  range: { from: string; to: string }
): Promise<ResolvedDay[]> {
  const [days] = await resolveAvailabilityForSubjects([subject], range)
  return days ?? []
}

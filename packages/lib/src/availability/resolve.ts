// packages/lib/src/availability/resolve.ts
//
// Resolve a subject's effective schedule for a date range (05-availability.md §A.2, and
// 01-data-model.md §4.1's precedence rule). Precedence, per date:
//   1. the subject's own exception rows for that date
//   2. org-level exception rows for that date (org exceptions apply to every subject)
//   3. the subject's own weekly rows for that weekday
//   4. the org's weekly rows for that weekday — fallback ONLY when the subject has ZERO
//      weekly rows overall (not per-day; e.g. an inheriting worker)
//
// All rows for the window are fetched once up front and resolved in memory.

import { database, schema } from '@auxx/database'
import { and, eq, gte, lte } from 'drizzle-orm'
import { dayOfWeekFromDate, enumerateDates } from './dates'
import { groupExceptionRowsByDate } from './exceptions'
import { subjectConditions } from './subject'
import type { AvailabilitySubject, ResolvedDay } from './types'
import { groupWeeklyRowsByDay } from './weekly-hours'

/** Effective ranges for every date in `[range.from, range.to]` (inclusive, capped at 366 days). */
export async function resolveAvailability(
  subject: AvailabilitySubject,
  range: { from: string; to: string }
): Promise<ResolvedDay[]> {
  const dates = enumerateDates(range.from, range.to)

  const orgSubject: AvailabilitySubject = {
    type: 'organization',
    organizationId: subject.organizationId,
  }
  const needsOrgFallback = subject.type !== 'organization'

  const [subjectExceptionRows, subjectWeeklyRows, orgExceptionRows, orgWeeklyRows] =
    await Promise.all([
      database.query.OperatingHours.findMany({
        where: and(
          subjectConditions(subject),
          eq(schema.OperatingHours.kind, 'exception'),
          gte(schema.OperatingHours.date, range.from),
          lte(schema.OperatingHours.date, range.to)
        ),
      }),
      database.query.OperatingHours.findMany({
        where: and(subjectConditions(subject), eq(schema.OperatingHours.kind, 'weekly')),
      }),
      needsOrgFallback
        ? database.query.OperatingHours.findMany({
            where: and(
              subjectConditions(orgSubject),
              eq(schema.OperatingHours.kind, 'exception'),
              gte(schema.OperatingHours.date, range.from),
              lte(schema.OperatingHours.date, range.to)
            ),
          })
        : Promise.resolve([]),
      needsOrgFallback
        ? database.query.OperatingHours.findMany({
            where: and(subjectConditions(orgSubject), eq(schema.OperatingHours.kind, 'weekly')),
          })
        : Promise.resolve([]),
    ])

  const subjectExceptionsByDate = groupExceptionRowsByDate(subjectExceptionRows)
  const orgExceptionsByDate = groupExceptionRowsByDate(orgExceptionRows)
  const subjectWeeklyByDay = groupWeeklyRowsByDay(subjectWeeklyRows)
  const orgWeeklyByDay = groupWeeklyRowsByDay(orgWeeklyRows)
  const subjectHasWeekly = subjectWeeklyRows.length > 0
  const subjectTimezone = subjectWeeklyRows[0]?.timezone ?? 'UTC'
  const orgTimezone = orgWeeklyRows[0]?.timezone ?? 'UTC'

  return dates.map((date): ResolvedDay => {
    const subjectException = subjectExceptionsByDate.get(date)
    if (subjectException) {
      return { date, ranges: subjectException.ranges, timezone: subjectException.timezone }
    }

    const orgException = orgExceptionsByDate.get(date)
    if (orgException) {
      return { date, ranges: orgException.ranges, timezone: orgException.timezone }
    }

    const dayOfWeek = dayOfWeekFromDate(date)

    if (subjectHasWeekly) {
      const day = subjectWeeklyByDay.get(dayOfWeek)
      return { date, ranges: day?.ranges ?? [], timezone: day?.timezone ?? subjectTimezone }
    }

    const orgDay = orgWeeklyByDay.get(dayOfWeek)
    return { date, ranges: orgDay?.ranges ?? [], timezone: orgDay?.timezone ?? orgTimezone }
  })
}

// packages/lib/src/availability/weekly-hours.ts
//
// Read/replace a subject's recurring weekly schedule (`OperatingHours.kind = 'weekly'`,
// 05-availability.md §A.2).

import { database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { subjectColumns, subjectConditions } from './subject'
import type { AvailabilitySubject, TimeRange, WeeklyHours } from './types'
import { validateWeeklyHours } from './validation'

type WeeklyRow = typeof schema.OperatingHours.$inferSelect

/** Group weekly rows by `dayOfWeek`, ranges sorted by start. Shared by `getWeeklyHours` + `resolveAvailability`. */
export function groupWeeklyRowsByDay(
  rows: WeeklyRow[]
): Map<number, { ranges: TimeRange[]; timezone: string }> {
  const byDay = new Map<number, { ranges: TimeRange[]; timezone: string }>()

  for (const row of rows) {
    if (row.dayOfWeek === null || row.startMinute === null || row.endMinute === null) continue
    const existing = byDay.get(row.dayOfWeek)
    const range = { start: row.startMinute, end: row.endMinute }
    if (existing) {
      existing.ranges.push(range)
    } else {
      byDay.set(row.dayOfWeek, { ranges: [range], timezone: row.timezone })
    }
  }

  for (const day of byDay.values()) {
    day.ranges.sort((a, b) => a.start - b.start)
  }

  return byDay
}

/** A subject's weekly schedule, or `null` when it has zero weekly rows (e.g. an inheriting worker). */
export async function getWeeklyHours(subject: AvailabilitySubject): Promise<WeeklyHours | null> {
  const rows = await database.query.OperatingHours.findMany({
    where: and(subjectConditions(subject), eq(schema.OperatingHours.kind, 'weekly')),
  })
  if (rows.length === 0) return null

  const byDay = groupWeeklyRowsByDay(rows)
  const days = Array.from(byDay.entries())
    .map(([dayOfWeek, { ranges }]) => ({ dayOfWeek, ranges }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)

  return { timezone: rows[0]!.timezone, days }
}

/**
 * Transactional replace-all of a subject's weekly rows — validates first, then deletes and
 * re-inserts within one transaction. `weekly.timezone` is stamped on every row (05-availability.md
 * decision 4: one timezone per subject).
 */
export async function saveWeeklyHours(
  subject: AvailabilitySubject,
  weekly: WeeklyHours
): Promise<void> {
  const errors = validateWeeklyHours(weekly)
  if (errors.length > 0) {
    throw new BadRequestError(errors.join('; '))
  }

  const columns = subjectColumns(subject)
  const lockKey = `${columns.organizationId}:${columns.subjectType}:${columns.userId ?? columns.widgetId ?? ''}`

  await database.transaction(async (tx) => {
    // Serialize concurrent replace-alls for the SAME subject: under READ COMMITTED, two
    // overlapping delete+insert transactions each see nothing to delete and BOTH insert,
    // leaving a union of both payloads. The xact lock releases automatically at commit.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('availability:weekly'), hashtext(${lockKey}))`
    )

    await tx
      .delete(schema.OperatingHours)
      .where(and(subjectConditions(subject), eq(schema.OperatingHours.kind, 'weekly')))

    const rows = weekly.days.flatMap((day) =>
      day.ranges.map((range) => ({
        ...columns,
        kind: 'weekly' as const,
        dayOfWeek: day.dayOfWeek,
        startMinute: range.start,
        endMinute: range.end,
        timezone: weekly.timezone,
      }))
    )

    if (rows.length > 0) {
      await tx.insert(schema.OperatingHours).values(rows)
    }
  })
}

// packages/lib/src/availability/exceptions.ts
//
// Read/write one-off exceptions (`OperatingHours.kind = 'exception'`, 05-availability.md §A.2).
// A date range materializes N per-date rows on write (one row per date, or one row per
// date-per-range for special hours); reads regroup contiguous same-shape dates back into a
// single `ExceptionGroup`.

import { database, schema } from '@auxx/database'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { BadRequestError } from '../errors'
import { diffDays, enumerateDates } from './dates'
import { subjectColumns, subjectConditions } from './subject'
import type {
  AddExceptionInput,
  AvailabilitySubject,
  ExceptionGroup,
  ExceptionListRange,
  TimeRange,
} from './types'
import { validateRanges } from './validation'
import { getWeeklyHours } from './weekly-hours'

type ExceptionRow = typeof schema.OperatingHours.$inferSelect

/** One calendar date's resolved exception shape — the merge unit before contiguous-run collapsing. */
interface DateShape {
  date: string
  isAvailable: boolean
  label: string | null
  timezone: string
  ranges: TimeRange[]
  ids: string[]
}

/** Group exception rows by date — multiple rows on the same date (special-hours ranges) merge into one shape. */
export function groupExceptionRowsByDate(rows: ExceptionRow[]): Map<string, DateShape> {
  const byDate = new Map<string, DateShape>()

  for (const row of rows) {
    if (!row.date) continue
    const range =
      row.isAvailable && row.startMinute !== null && row.endMinute !== null
        ? { start: row.startMinute, end: row.endMinute }
        : null

    const existing = byDate.get(row.date)
    if (existing) {
      existing.ids.push(row.id)
      if (range) existing.ranges.push(range)
    } else {
      byDate.set(row.date, {
        date: row.date,
        isAvailable: row.isAvailable,
        label: row.label,
        timezone: row.timezone,
        ranges: range ? [range] : [],
        ids: [row.id],
      })
    }
  }

  for (const shape of byDate.values()) {
    shape.ranges.sort((a, b) => a.start - b.start)
  }

  return byDate
}

function sameShape(a: DateShape, b: DateShape): boolean {
  if (a.isAvailable !== b.isAvailable) return false
  if ((a.label ?? null) !== (b.label ?? null)) return false
  if (a.ranges.length !== b.ranges.length) return false
  return a.ranges.every((r, i) => r.start === b.ranges[i]!.start && r.end === b.ranges[i]!.end)
}

/** Collapse contiguous (date diff = 1) same-shape dates into single `ExceptionGroup`s. */
function mergeContiguous(shapes: DateShape[]): ExceptionGroup[] {
  const groups: Array<{ shape: DateShape; dateFrom: string; dateTo: string; ids: string[] }> = []

  for (const shape of shapes) {
    const last = groups.at(-1)
    if (last && diffDays(last.dateTo, shape.date) === 1 && sameShape(last.shape, shape)) {
      last.dateTo = shape.date
      last.ids.push(...shape.ids)
    } else {
      groups.push({ shape, dateFrom: shape.date, dateTo: shape.date, ids: [...shape.ids] })
    }
  }

  return groups.map((group) => ({
    ids: group.ids,
    dateFrom: group.dateFrom,
    dateTo: group.dateTo,
    label: group.shape.label,
    isAvailable: group.shape.isAvailable,
    ranges: group.shape.ranges,
  }))
}

/** A subject's exceptions, regrouped into contiguous runs and sorted by `dateFrom`. */
export async function listExceptions(
  subject: AvailabilitySubject,
  range?: ExceptionListRange
): Promise<ExceptionGroup[]> {
  const conditions = [subjectConditions(subject), eq(schema.OperatingHours.kind, 'exception')]
  if (range?.from) conditions.push(gte(schema.OperatingHours.date, range.from))
  if (range?.to) conditions.push(lte(schema.OperatingHours.date, range.to))

  const rows = await database.query.OperatingHours.findMany({
    where: and(...conditions),
    orderBy: (oh, { asc }) => [asc(oh.date)],
  })

  const shapes = [...groupExceptionRowsByDate(rows).values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  )
  return mergeContiguous(shapes)
}

/**
 * Validate + materialize an exception input into the per-date `OperatingHours` insert rows
 * (one row per date, or one row per date-per-range for special hours). Shared by
 * {@link addException} and {@link updateException}.
 */
async function materializeExceptionRows(
  subject: AvailabilitySubject,
  input: AddExceptionInput
): Promise<Array<typeof schema.OperatingHours.$inferInsert>> {
  const dateFrom = input.dateFrom
  const dateTo = input.dateTo ?? input.dateFrom
  const dates = enumerateDates(dateFrom, dateTo)

  let ranges: TimeRange[] = []
  if (input.isAvailable) {
    ranges = input.ranges ?? []
    if (ranges.length === 0) {
      throw new BadRequestError('Special hours require at least one time range')
    }
    const errors = validateRanges(ranges)
    if (errors.length > 0) {
      throw new BadRequestError(errors.join('; '))
    }
  }

  const weekly = await getWeeklyHours(subject)
  const timezone = weekly?.timezone ?? 'UTC'
  const columns = subjectColumns(subject)
  const label = input.label ?? null

  return dates.flatMap(
    (date): Array<typeof schema.OperatingHours.$inferInsert> =>
      input.isAvailable
        ? ranges.map((range) => ({
            ...columns,
            kind: 'exception' as const,
            date,
            isAvailable: true,
            label,
            timezone,
            dayOfWeek: null,
            startMinute: range.start,
            endMinute: range.end,
          }))
        : [
            {
              ...columns,
              kind: 'exception' as const,
              date,
              isAvailable: false,
              label,
              timezone,
              dayOfWeek: null,
              startMinute: null,
              endMinute: null,
            },
          ]
  )
}

/**
 * Materialize a date-range exception into per-date rows (one row per date, or one row per
 * date-per-range for special hours) in a single transaction.
 */
export async function addException(
  subject: AvailabilitySubject,
  input: AddExceptionInput
): Promise<void> {
  const rows = await materializeExceptionRows(subject, input)
  await database.transaction(async (tx) => {
    await tx.insert(schema.OperatingHours).values(rows)
  })
}

/**
 * Replace an existing exception group with a fresh materialization. The old group's rows
 * (`ids`, always re-scoped to subject + org + `kind = 'exception'` — ids alone are never
 * trusted) are deleted and the new per-date rows inserted in one transaction, so an edit that
 * changes the date span, mode, or ranges never leaves stale rows behind.
 */
export async function updateException(
  subject: AvailabilitySubject,
  ids: string[],
  input: AddExceptionInput
): Promise<void> {
  const rows = await materializeExceptionRows(subject, input)

  await database.transaction(async (tx) => {
    if (ids.length > 0) {
      await tx
        .delete(schema.OperatingHours)
        .where(
          and(
            subjectConditions(subject),
            eq(schema.OperatingHours.kind, 'exception'),
            inArray(schema.OperatingHours.id, ids)
          )
        )
    }
    await tx.insert(schema.OperatingHours).values(rows)
  })
}

/**
 * Delete a group of exception rows by id. Every predicate is scoped to the subject + org —
 * ids alone are never trusted.
 */
export async function deleteException(subject: AvailabilitySubject, ids: string[]): Promise<void> {
  if (ids.length === 0) return

  await database
    .delete(schema.OperatingHours)
    .where(
      and(
        subjectConditions(subject),
        eq(schema.OperatingHours.kind, 'exception'),
        inArray(schema.OperatingHours.id, ids)
      )
    )
}

// packages/lib/src/workflow-engine/query-builder/relative-date-range.ts

import type { Operator } from '../../conditions/operator-definitions'

export interface DateRange {
  /** Inclusive lower bound. */
  start: Date
  /** Exclusive upper bound. */
  end: Date
}

/**
 * Resolve a relative-date operator (today, yesterday, this_week, this_month,
 * within_days) to a concrete `[start, end)` half-open range. Returns `null` for
 * non-relative operators or when `rawValue` is required but invalid — callers
 * should fall through to their default branch.
 *
 * `older_than_days` is intentionally excluded: it has no upper bound and is
 * better expressed as a single `column < cutoff` comparison upstream.
 *
 * Semantics mirror `evaluate.ts` (server local time, week starts Sunday) so
 * client-side and server-side filtering agree on the same set of rows. A
 * timezone-aware variant is a separate follow-up.
 */
export function resolveRelativeDateRange(
  operator: Operator,
  rawValue: unknown,
  now: Date = new Date()
): DateRange | null {
  switch (operator) {
    case 'today': {
      const start = startOfDay(now)
      return { start, end: addDays(start, 1) }
    }
    case 'yesterday': {
      const start = addDays(startOfDay(now), -1)
      return { start, end: addDays(start, 1) }
    }
    case 'this_week': {
      const start = startOfWeek(now)
      return { start, end: addDays(start, 7) }
    }
    case 'this_month': {
      const start = startOfMonth(now)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      return { start, end }
    }
    case 'within_days': {
      if (rawValue === null || rawValue === undefined) return null
      const days = Number(rawValue)
      if (!Number.isFinite(days)) return null
      // Match evaluate.ts: diffDays >= 0 && diffDays <= days, i.e.
      // [now - days, now]. Express as half-open [now - days, now + 1ms).
      const end = new Date(now.getTime() + 1)
      const start = new Date(now.getTime() - days * MS_PER_DAY)
      return { start, end }
    }
    default:
      return null
  }
}

/**
 * Cutoff for `older_than_days`: returns the timestamp `days` ago. Caller
 * compares `column < cutoff`. Returns `null` for invalid input.
 */
export function resolveOlderThanCutoff(rawValue: unknown, now: Date = new Date()): Date | null {
  if (rawValue === null || rawValue === undefined) return null
  const days = Number(rawValue)
  if (!Number.isFinite(days)) return null
  return new Date(now.getTime() - days * MS_PER_DAY)
}

const MS_PER_DAY = 86_400_000

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

function startOfWeek(d: Date): Date {
  const out = startOfDay(d)
  out.setDate(out.getDate() - out.getDay())
  return out
}

function startOfMonth(d: Date): Date {
  const out = new Date(d)
  out.setDate(1)
  out.setHours(0, 0, 0, 0)
  return out
}

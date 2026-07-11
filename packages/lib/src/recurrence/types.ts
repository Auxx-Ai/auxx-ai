// packages/lib/src/recurrence/types.ts
//
// The generic recurrence pattern shape (plans/dispatch/06-recurring-engine.md §2.1) — a typed
// 1:1 mapping to the Jobber-style picker (Daily / Weekly (pick weekdays) / Every N weeks /
// Monthly (day-of-month OR nth-weekday) + end condition). Pure, client-safe: no
// `@auxx/database` imports. `recurrencePatternSchema` backs both the `dispatch.setRecurrence`
// tRPC input and the picker's react-hook-form resolver.

import { z } from 'zod'

/** One weekday, JS `Date#getDay()` convention: `0` = Sunday … `6` = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** The nth occurrence of a weekday within a month; `-1` = the last one. */
export type NthWeekdayOrdinal = 1 | 2 | 3 | 4 | -1

/**
 * A recurring visit/invoice-draft rule. Frequency-specific fields are optional at the type
 * level but enforced by {@link recurrencePatternSchema}: weekly requires non-empty
 * `weekdays`; monthly requires exactly one of `monthDay`/`nthWeekday`; the end condition is
 * at most one of `until`/`count` (neither set = never-ending).
 */
export interface RecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly'
  /** Every N days/weeks/months, `>= 1` (e.g. biweekly = `{ frequency: 'weekly', interval: 2 }`). */
  interval: number
  /** Weekly only — the weekdays the rule fires on. */
  weekdays?: Weekday[]
  /** Monthly only — day-of-month (1-31); clamps to the last day of short months (e.g. Feb). */
  monthDay?: number
  /** Monthly only — e.g. "2nd Tuesday" is `{ nth: 2, weekday: 2 }`. */
  nthWeekday?: { nth: NthWeekdayOrdinal; weekday: Weekday }
  /** Inclusive end date, local ISO `YYYY-MM-DD` (local to the rule's `timezone`). */
  until?: string
  /** Total occurrence count across the whole series (not just the current expansion window). */
  count?: number
}

const weekdaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])

const nthWeekdayOrdinalSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(-1),
])

/**
 * Validates a {@link RecurrencePattern}, including the cross-field rules the type alone can't
 * express:
 * - `frequency: 'weekly'` requires a non-empty `weekdays`.
 * - `frequency: 'monthly'` requires exactly one of `monthDay` / `nthWeekday`.
 * - `until` and `count` are mutually exclusive (neither set = the rule never ends on its own).
 * - `interval >= 1`.
 *
 * Used as both the `dispatch.setRecurrence` tRPC input and the picker's form resolver.
 */
export const recurrencePatternSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1),
    weekdays: z.array(weekdaySchema).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    nthWeekday: z.object({ nth: nthWeekdayOrdinalSchema, weekday: weekdaySchema }).optional(),
    until: z.string().optional(),
    count: z.number().int().min(1).optional(),
  })
  .superRefine((pattern, ctx) => {
    if (pattern.frequency === 'weekly' && (pattern.weekdays?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekdays'],
        message: 'Weekly recurrence requires at least one weekday',
      })
    }

    if (pattern.frequency === 'monthly') {
      const hasMonthDay = pattern.monthDay !== undefined
      const hasNthWeekday = pattern.nthWeekday !== undefined
      if (hasMonthDay === hasNthWeekday) {
        ctx.addIssue({
          code: 'custom',
          path: ['monthDay'],
          message: 'Monthly recurrence requires exactly one of monthDay or nthWeekday',
        })
      }
    }

    if (pattern.until !== undefined && pattern.count !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['until'],
        message: 'A recurrence can end on a date or after a count, not both',
      })
    }
  })

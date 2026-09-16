// apps/web/src/components/money/ui/batch-posting/range.ts

/**
 * Calendar days and months in, one half-open window out.
 *
 * 🛑 **Inclusive in the UI, half-open on the wire (§6.1 of
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md`).** The "March
 * 31 is missing" report was verified NOT to be a timezone bug: the range really
 * is `from <= x < to`, the old To row's own label said so, and MK read that
 * label and still expected March 31. Half-open stays on the wire - it is what
 * lets two consecutive runs tile a month without overlapping, and the planner,
 * the claim key and `countUnpostedShipments` all depend on it. So the CONTROL
 * now takes an inclusive end and this file adds the day, and the explanatory
 * label is gone.
 *
 * The calendar arithmetic itself is `@auxx/utils/calendar-day`; what is left
 * here is the inclusive-to-half-open translation, which is this screen's own.
 */

import {
  addDaysToDayKey,
  dayKeyOfLocalDate,
  endOfMonthDay,
  localDateOfDayKey,
  monthKeyOfDay,
  shiftMonthKey,
  startOfMonthDay,
} from '@auxx/utils/calendar-day'

export { dayKeyOfLocalDate as dayKeyOf, localDateOfDayKey as dateOfDayKey, monthKeyOfDay }

/** `'2026-03-31'` becomes `'2026-04-01'`. */
export const nextDayKey = (dayKey: string): string => addDaysToDayKey(dayKey, 1)

/** `'2026-03'` becomes `'2026-04'`. */
export const nextMonthKey = (monthKey: string): string => shiftMonthKey(monthKey, 1)

/** `'2026-03'` becomes `'2026-03-01'`. */
export const firstDayOfMonth = startOfMonthDay

/** `'2026-03'` becomes `'2026-03-31'`. */
export const lastDayOfMonth = endOfMonthDay

/**
 * A month range, both ends INCLUSIVE, as the half-open window the wire takes.
 *
 * January through March yields `2026-01-01 .. 2026-04-01`, which includes
 * March 31 (acceptance item 6) without anyone having to know that.
 */
export function monthRangeToWire(from: string, to: string): { from: string; to: string } {
  return { from: firstDayOfMonth(from), to: firstDayOfMonth(nextMonthKey(to)) }
}

/** A day range, both ends INCLUSIVE, as the half-open window the wire takes. */
export function dayRangeToWire(from: string, to: string): { from: string; to: string } {
  return { from, to: nextDayKey(to) }
}

/** The first day of last month, the window a monthly close asks for. */
export function startOfLastMonthDayKey(now = new Date()): string {
  return startOfMonthDay(shiftMonthKey(monthKeyOfDay(dayKeyOfLocalDate(now)), -1))
}

/** Today in the viewer's own zone, inclusive. The server re-cuts it in book time. */
export function todayDayKey(now = new Date()): string {
  return dayKeyOfLocalDate(now)
}

/** Last month, `'2026-01'`. The month a backlog run almost always starts on. */
export function lastMonthKey(now = new Date()): string {
  return monthKeyOfDay(startOfLastMonthDayKey(now))
}

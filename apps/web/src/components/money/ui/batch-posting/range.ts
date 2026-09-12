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
 * Every function here is pure and zone-free: a `YYYY-MM-DD` is a calendar day,
 * and the server re-cuts it in book time.
 */

/** `'2026-03-31'` becomes `'2026-04-01'`. UTC arithmetic on a zone-free day. */
export function nextDayKey(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) return dayKey
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1))
  return next.toISOString().slice(0, 10)
}

/** `'2026-03'` becomes `'2026-04'`. */
export function nextMonthKey(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) return monthKey
  const year = Number(match[1])
  const month = Number(match[2])
  const rolls = month === 12
  return `${String(rolls ? year + 1 : year).padStart(4, '0')}-${String(
    rolls ? 1 : month + 1
  ).padStart(2, '0')}`
}

/** `'2026-03'` becomes `'2026-03-01'`. */
export function firstDayOfMonth(monthKey: string): string {
  return `${monthKey}-01`
}

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

/**
 * The calendar day a `Date` falls on in the VIEWER's zone.
 *
 * The same rule `toCalendarDayIso` uses (`field-values/calendar-day.ts:24`):
 * local `getFullYear/getMonth/getDate`, because what somebody clicked on a
 * calendar is the day they meant, not an instant.
 */
export function dayKeyOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Midday local, so a `Date` round-tripped through a picker never slips a day. */
export function dateOfDayKey(dayKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) return new Date(Number.NaN)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
}

/** `'2026-03-31'`'s month, `'2026-03'`. */
export function monthKeyOfDay(dayKey: string): string {
  return dayKey.slice(0, 7)
}

/** The first day of last month, the window a monthly close asks for. */
export function startOfLastMonthDayKey(now = new Date()): string {
  return dayKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

/** Today in the viewer's own zone, inclusive. The server re-cuts it in book time. */
export function todayDayKey(now = new Date()): string {
  return dayKeyOf(now)
}

/** Last month, `'2026-01'`. The month a backlog run almost always starts on. */
export function lastMonthKey(now = new Date()): string {
  return monthKeyOfDay(startOfLastMonthDayKey(now))
}

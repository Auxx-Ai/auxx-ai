// packages/utils/src/calendar-day.ts

/**
 * Calendar days (`YYYY-MM-DD`) and calendar months (`YYYY-MM`) as values.
 *
 * 🛑 **Two kinds of function live here and they must not be mixed up.** The
 * arithmetic half (`addMonthsToDayKey`, `endOfMonthDay`, …) takes a calendar
 * key and returns a calendar key: it is timezone-free by construction, because
 * the day after `2026-08-31` is `2026-09-01` in every zone there is. The
 * conversion half (`dayKeyInZone`, `startOfDayInstant`, …) crosses between an
 * INSTANT and a calendar day, and every one of those takes an explicit
 * `timeZone` — a receipt at 7pm on Jan 31 in `America/New_York` is already
 * Feb 1 in UTC, so converting in the wrong zone posts it to the wrong month.
 *
 * ⚠️ The arithmetic half anchors every key on a LOCAL `Date` and formats it
 * back with local getters, so it never crosses an instant boundary and the
 * host's own zone cannot leak into the result. Do not "simplify" it to
 * `Date.UTC` + `toISOString`: that is a conversion, and it belongs to the
 * other half of this file.
 */

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  isValid,
  lastDayOfMonth,
  startOfMonth,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** A calendar day, `'2026-08-31'`. */
export type DayKey = string
/** A calendar month, `'2026-08'`. */
export type MonthKey = string

/**
 * A day key as a local `Date` at MIDDAY, or an invalid `Date`.
 *
 * Midday rather than midnight because midnight does not exist on every
 * calendar day in every zone (DST can begin at 00:00), and a `Date` that
 * silently lands on 01:00 of the same day is fine while one that lands on
 * 23:00 of the previous day is not.
 */
function dateOf(key: MonthKey | DayKey): Date {
  const match = DAY_PATTERN.exec(DAY_PATTERN.test(key) ? key : `${key}-01`)
  if (!match?.[1] || !match[2] || !match[3]) return new Date(Number.NaN)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(year, month - 1, day, 12)
  // The constructor normalizes overflow silently (Feb 30 -> Mar 2), so
  // round-trip and compare rather than trusting construction to fail.
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return new Date(Number.NaN)
  probe.setFullYear(year)
  return probe
}

/** A `Date` back to the calendar day it names locally, or `fallback` when it is invalid. */
function keyOf(date: Date, fallback: string): DayKey {
  return isValid(date) ? format(date, 'yyyy-MM-dd') : fallback
}

// ── Calendar arithmetic (timezone-free) ────────────────────────────────────

/** `'2026-08-31'` -> `'2026-08'`. Returns the input unchanged if it is not a day key. */
export function monthKeyOfDay(dayKey: DayKey): MonthKey {
  return DAY_PATTERN.test(dayKey) ? dayKey.slice(0, 7) : dayKey
}

/** `'2026-02'` -> `'2026-02-01'`. Accepts a day key and returns its month's first day. */
export function startOfMonthDay(key: MonthKey | DayKey): DayKey {
  return keyOf(startOfMonth(dateOf(key)), key)
}

/** `'2026-02'` -> `'2026-02-28'`, leap years included. Accepts a day key too. */
export function endOfMonthDay(key: MonthKey | DayKey): DayKey {
  return keyOf(lastDayOfMonth(dateOf(key)), key)
}

/** Shift a `'YYYY-MM'` key by `deltaMonths` (negative moves back). Unchanged if malformed. */
export function shiftMonthKey(monthKey: MonthKey, deltaMonths: number): MonthKey {
  const date = dateOf(monthKey)
  return isValid(date) ? format(addMonths(date, deltaMonths), 'yyyy-MM') : monthKey
}

/** Whole months between two keys, `to - from`. `null` if either is malformed. */
export function monthsBetween(from: MonthKey | DayKey, to: MonthKey | DayKey): number | null {
  const a = dateOf(from)
  const b = dateOf(to)
  if (!isValid(a) || !isValid(b)) return null
  return differenceInCalendarMonths(b, a)
}

/**
 * Shift a DAY key by whole months, keeping the day of the month and CLAMPING
 * to the target month's length — `addMonths`'s own documented behaviour.
 *
 * 🛑 The clamp is the whole point. Naive construction rolls Feb 31 over to
 * March 3, so "one month before March 31" would come back as March 3 rather
 * than February 28 — a range that moves FORWARD when asked to move back.
 */
export function addMonthsToDayKey(dayKey: DayKey, deltaMonths: number): DayKey {
  return keyOf(addMonths(dateOf(dayKey), deltaMonths), dayKey)
}

/** Shift a day key by whole days. Unchanged if malformed. */
export function addDaysToDayKey(dayKey: DayKey, deltaDays: number): DayKey {
  return keyOf(addDays(dateOf(dayKey), deltaDays), dayKey)
}

/** The calendar day immediately before `dayKey`. */
export function previousDayKey(dayKey: DayKey): DayKey {
  return addDaysToDayKey(dayKey, -1)
}

/** Whole days between two day keys, `to - from`. `null` if either is malformed. */
export function daysBetween(from: DayKey, to: DayKey): number | null {
  const a = dateOf(from)
  const b = dateOf(to)
  if (!isValid(a) || !isValid(b)) return null
  return differenceInCalendarDays(b, a)
}

// ── Instant <-> calendar day (timezone-aware) ──────────────────────────────

/** The calendar day an instant falls on, in `timeZone`. */
export function dayKeyInZone(date: Date, timeZone: string): DayKey {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd')
}

/** Today's calendar day in `timeZone`. Never the viewer's zone unless you pass it. */
export function todayInZone(timeZone: string, now: Date = new Date()): DayKey {
  return dayKeyInZone(now, timeZone)
}

/**
 * The instant at which `dayKey` begins in `timeZone`. Invalid input yields an
 * invalid `Date`.
 *
 * `fromZonedTime` reads the wall-clock string as local to the zone and returns
 * the UTC instant it corresponds to. Hand-rolled offset arithmetic gets DST
 * wrong roughly twice a year, and one of those two times is a month boundary.
 */
export function startOfDayInstant(dayKey: DayKey, timeZone: string): Date {
  return fromZonedTime(`${dayKey}T00:00:00`, timeZone)
}

/** The instant at which `monthKey` begins in `timeZone`. */
export function startOfMonthInstant(monthKey: MonthKey, timeZone: string): Date {
  return startOfDayInstant(startOfMonthDay(monthKey), timeZone)
}

// ── Calendar widgets (the viewer's own zone) ───────────────────────────────

/**
 * A local `Date` from a picker, as the day the viewer clicked.
 *
 * ⚠️ Local formatting on purpose. This is the ONE place the viewer's zone is
 * the right zone, because the input is a click on a grid of days, not an
 * instant.
 */
export function dayKeyOfLocalDate(date: Date): DayKey {
  return format(date, 'yyyy-MM-dd')
}

/** Midday local, so a `Date` round-tripped through a picker never slips a day. */
export function localDateOfDayKey(dayKey: DayKey): Date {
  return dateOf(dayKey)
}

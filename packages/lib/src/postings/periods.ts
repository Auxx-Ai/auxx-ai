// packages/lib/src/postings/periods.ts
//
// PURE. `periodKey` derivation and the period lock.
//
// A `periodKey` is the summarization window of a posting: a day for a
// per-event entry (`'2026-08-18'`), a month for a month-end one (`'2026-08'`).
// Together with the posting type it is what makes a double-post unrepresentable
// at the source rather than merely detected at the destination - see the JSDoc
// on `GL_POSTING_FIELDS` in resources/registry/resources/gl-posting-fields.ts.

import { BadRequestError, UnprocessableEntityError } from '../errors'

/** `'day'` -> `'2026-08-18'`, `'month'` -> `'2026-08'`. */
export type PeriodGranularity = 'day' | 'month'

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/

/**
 * Derive the `periodKey` for an instant.
 *
 * **`timeZone` is not optional decoration.** A receipt logged at 7pm on
 * January 31 in `America/New_York` is already February 1 in UTC. Derive the key
 * in UTC and that receipt posts to the wrong month - a one-line error that is
 * invisible except at a close, and that cannot be corrected once the period is
 * locked. So the caller passes the organization's book timezone and this
 * function formats in it. The default is UTC, which is correct only when the
 * caller has already normalized.
 *
 * Formatting goes through `Intl.DateTimeFormat` with the `en-CA` locale because
 * that locale's short date format IS `YYYY-MM-DD`; hand-rolled offset arithmetic
 * gets DST wrong roughly twice a year.
 */
export function periodKeyForDate(
  date: Date,
  granularity: PeriodGranularity = 'day',
  timeZone = 'UTC'
): string {
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError('Cannot derive a period key from an invalid date')
  }
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

  return granularity === 'month' ? iso.slice(0, 7) : iso
}

export interface ParsedPeriodKey {
  granularity: PeriodGranularity
  year: number
  /** 1-12. */
  month: number
  /** 1-31, only for `'day'` keys. */
  day?: number
}

/**
 * Parse and validate a `periodKey`.
 *
 * Strict on purpose: a malformed key is a malformed document number is a broken
 * idempotency key, and every one of those failures surfaces as a duplicate
 * entry rather than as an error. `'2026-8'` and `'2026-08-32'` are rejected
 * here, loudly, rather than three layers down.
 *
 * @throws {BadRequestError} when the key is not `YYYY-MM` or `YYYY-MM-DD`, or
 * names a calendar date that does not exist.
 */
export function parsePeriodKey(periodKey: string): ParsedPeriodKey {
  const dayMatch = DAY_PATTERN.exec(periodKey)
  if (dayMatch) {
    const year = Number(dayMatch[1])
    const month = Number(dayMatch[2])
    const day = Number(dayMatch[3])
    assertRealDate(periodKey, year, month, day)
    return { granularity: 'day', year, month, day }
  }

  const monthMatch = MONTH_PATTERN.exec(periodKey)
  if (monthMatch) {
    const year = Number(monthMatch[1])
    const month = Number(monthMatch[2])
    assertRealDate(periodKey, year, month, 1)
    return { granularity: 'month', year, month }
  }

  throw new BadRequestError(`Invalid period key "${periodKey}" - expected YYYY-MM-DD or YYYY-MM`, {
    periodKey,
  })
}

function assertRealDate(periodKey: string, year: number, month: number, day: number): void {
  if (month < 1 || month > 12) {
    throw new BadRequestError(`Invalid period key "${periodKey}" - month ${month} is not 1-12`, {
      periodKey,
    })
  }
  // Date.UTC normalizes overflow silently (Feb 30 -> Mar 2), so round-trip and
  // compare rather than trusting construction to fail.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) {
    throw new BadRequestError(`Invalid period key "${periodKey}" - not a real date`, { periodKey })
  }
  if (probe.getUTCDate() !== day) {
    throw new BadRequestError(`Invalid period key "${periodKey}" - not a real date`, { periodKey })
  }
}

/**
 * The accounting month a period key falls in - `'2026-08'` for both
 * `'2026-08-18'` and `'2026-08'`.
 *
 * Periods lock by month, and a day key belongs to the month that contains it, so
 * every lock comparison goes through this rather than comparing raw keys of
 * different shapes.
 */
export function periodMonth(periodKey: string): string {
  const parsed = parsePeriodKey(periodKey)
  return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}`
}

/**
 * Order two `YYYY-MM` months. Negative when `a` is earlier.
 *
 * Zero-padded `YYYY-MM` sorts lexicographically in calendar order, which is the
 * one property that makes the lock check a string compare instead of date math.
 */
export function compareMonths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface PeriodLock {
  /**
   * The last month closed to new postings, `'2026-07'`, or `null` when nothing
   * is closed yet.
   *
   * Passed in rather than read from settings inside this module, for two
   * reasons: it keeps this file pure and exhaustively testable with no database,
   * and the lock has to mean the same thing in ledger mode (where it is entirely
   * ours) and in subledger mode (where it should track the provider's own closed
   * book). One caller resolves it; every check compares against it.
   */
  lockedThroughMonth: string | null
}

/**
 * Is this period closed to new postings?
 *
 * A period is locked when its month is at or before `lockedThroughMonth`.
 */
export function isPeriodLocked(periodKey: string, lock: PeriodLock): boolean {
  if (!lock.lockedThroughMonth) return false
  return compareMonths(periodMonth(periodKey), lock.lockedThroughMonth) <= 0
}

/**
 * Throw unless the period is open.
 *
 * Called before a posting is built, not after: a posting into a closed month
 * cannot be un-posted at the provider by anything this system can do, and the
 * accountant who closed the month has already filed numbers that no longer
 * match. Refusing at the door is the only cheap moment.
 *
 * @throws {UnprocessableEntityError} when the period is locked.
 */
export function assertPeriodOpen(periodKey: string, lock: PeriodLock): void {
  if (isPeriodLocked(periodKey, lock)) {
    throw new UnprocessableEntityError(
      `Accounting period ${periodMonth(periodKey)} is closed through ${lock.lockedThroughMonth} - post to an open period`,
      { periodKey, lockedThroughMonth: lock.lockedThroughMonth ?? '' }
    )
  }
}

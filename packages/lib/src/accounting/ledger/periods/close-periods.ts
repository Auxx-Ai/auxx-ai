// packages/lib/src/accounting/ledger/periods/close-periods.ts
//
// The close console's period strip: which months exist, and what state each one
// is in (plans/money/tasks/14-drive-the-close.md section 6).
//
// ## There is no table, and there does not need to be one
//
// Task 13 deferred the `gl_close_period` entity pair, and this module is why
// that deferral holds: every answer here is DERIVED from three things that
// already exist.
//
//   * `accounting.cutoffPeriod` - the last month the OLD system owned, so the
//     strip starts the month after it. Months at or before the cutoff are
//     covered by the frozen opening baseline and can never be closed here.
//   * `ledger.lockedThroughMonth` - a month at or below it is `locked`.
//
// Storing that would mean maintaining a second copy of a fact the ledger already
// holds, and the two would eventually disagree. The ledger wins that argument
// every time, so there is nothing for a table to hold.
//
// ⚠️ There is no `posted` state. MIGRATION step 5 deleted the month-end
// assertion, so a close posts nothing and there is no entry for a state to be
// about; what a close owes is the blocker list in `read-close-blockers.ts`.

import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../../errors'
import { readOrganizationSettings } from '../../../settings/read'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup/setup-readiness'
import type { ClosePeriod } from '../types'
import { PERIOD_LOCK_SETTING_KEY } from './period-lock'
import { compareMonths, parsePeriodKey, periodKeyForDate } from './periods'

/**
 * How many months the strip will render before it refuses.
 *
 * A cutoff mistyped as `1926-12` would otherwise ask this function for twelve
 * hundred rows and the console for a dropdown nobody can use. Refusing names the
 * setting to fix; truncating silently would leave a bookkeeper scrolling for a
 * month that was never rendered.
 */
const MAX_PERIODS = 240

/**
 * Every month from the accounting cutoff to now, with its state.
 *
 * Oldest first, so the console's "earliest open month" is simply the first
 * `open` entry and no caller has to know the sort order.
 *
 * @param organizationId The organization whose books these are.
 * @returns The strip, or an {@link UnprocessableEntityError} naming the setting
 * to fix. An organization that has not finished setup has no cutoff yet and gets
 * an EMPTY strip rather than an error - the console renders the setup checklist
 * in that case, and refusing here would make "you have not started" look like a
 * failure.
 */
export async function listClosePeriods(
  organizationId: string
): Promise<Result<ClosePeriod[], Error>> {
  try {
    const settings = await readOrganizationSettings(organizationId, [
      OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
      OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
      PERIOD_LOCK_SETTING_KEY,
    ] as const)
    // A settings form that clears a text input writes '' rather than deleting
    // the row, so both spellings of "nothing is set" have to collapse to null.
    const cutoff = settings[OPENING_BASELINE_SETTING_KEYS.cutoffPeriod]?.trim() || null
    const bookTimeZone = settings[OPENING_BASELINE_SETTING_KEYS.bookTimeZone]?.trim() || null

    // Setup has not been done. Not an error: the module home renders the
    // checklist, and there is genuinely no month to show yet.
    if (!cutoff || !bookTimeZone) return ok([])

    const months = monthsAfter(cutoff, bookTimeZone)
    if (months.length === 0) return ok([])

    const lockedThrough = settings[PERIOD_LOCK_SETTING_KEY]?.trim() || null

    return ok(
      months.map((periodKey) => ({
        periodKey,
        state: resolveState(periodKey, lockedThrough),
      }))
    )
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * The months strictly after `cutoff`, through the current month in the book
 * timezone, oldest first.
 *
 * 🛑 "Now" is resolved in the BOOK timezone, not UTC and not the reader's.
 * On the last day of a month those disagree, and the disagreement would either
 * hide a month that is closable or offer one that has not finished.
 */
function monthsAfter(cutoff: string, bookTimeZone: string): string[] {
  // Validates the shape and throws a naming error if it is not a month.
  parsePeriodKey(cutoff)

  const current = periodKeyForDate(new Date(), 'month', bookTimeZone)
  if (compareMonths(current, cutoff) <= 0) return []

  const months: string[] = []
  let month = nextMonth(cutoff)

  while (compareMonths(month, current) <= 0) {
    months.push(month)
    if (months.length > MAX_PERIODS) {
      throw new UnprocessableEntityError(
        `The accounting cutoff ${cutoff} is more than ${MAX_PERIODS} months ago, which is not a ` +
          'range this console can render. Check accounting.cutoffPeriod.',
        {
          organizationId: undefined,
          setting: OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
          value: cutoff,
        }
      )
    }
    month = nextMonth(month)
  }

  return months
}

/** The month after `monthKey`. */
function nextMonth(monthKey: string): string {
  const { year, month } = parsePeriodKey(monthKey)
  const nextYear = month === 12 ? year + 1 : year
  const next = month === 12 ? 1 : month + 1
  return `${String(nextYear).padStart(4, '0')}-${String(next).padStart(2, '0')}`
}

/** One month's state: the lock, and nothing else, since the close posts nothing. */
function resolveState(
  periodKey: string,
  lockedThrough: string | null | undefined
): ClosePeriod['state'] {
  if (lockedThrough && isMonthKey(lockedThrough) && compareMonths(periodKey, lockedThrough) <= 0) {
    return 'locked'
  }
  return 'open'
}

/**
 * Whether a stored lock value is a usable month.
 *
 * ⚠️ Deliberately does NOT throw on a malformed value, which is where this
 * differs from `resolvePeriodLock`. That function fails closed because it guards
 * a WRITE: a bad lock read as "nothing is closed" would let a posting into a
 * closed month, and there is no un-post. This one only decides how a row is
 * TINTED in a list, and refusing to render the console over a malformed setting
 * would hide the settings screen that fixes it. The write path still fails
 * closed, so nothing can be posted while the value is broken.
 */
function isMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
}

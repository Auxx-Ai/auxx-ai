// packages/lib/src/postings/close-periods.ts
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
//   * the `GlPosting` rows - a month is `posted` when it has an effective
//     month-end entry.
//   * `ledger.lockedThroughMonth` - a month at or below it is `locked`.
//
// Storing that would mean maintaining a second copy of a fact the ledger already
// holds, and the two would eventually disagree. The ledger wins that argument
// every time, so there is nothing for a table to hold.
//
// ## `locked` and `posted` are different, and must not be collapsed
//
// A month can be locked without ever having been posted - an organization may
// lock a range it does not intend to close - and a posted month is not locked
// until somebody says so. They call for different actions from a reader, which
// is why `ClosePeriod.state` carries three values and not a boolean.
//
// 🛑 **`revision` is not a count of postings.** A reversal chain writes a NEW
// row per revision and flips the previous one to `reversed`, so the EFFECTIVE
// posting for a month is the highest-revision row that is not itself reversed.
// Taking the newest row by `createdAt`, or counting rows, would both report a
// reversed month as posted.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../errors'
import { getOrganizationSetting } from '../settings/settings-service'
import { PERIOD_LOCK_SETTING_KEY } from './period-lock'
import { compareMonths, parsePeriodKey, periodKeyForDate } from './periods'
import { OPENING_BASELINE_SETTING_KEYS } from './setup-readiness'
import type { ClosePeriod } from './types'

/**
 * How many months the strip will render before it refuses.
 *
 * A cutoff mistyped as `1926-12` would otherwise ask this function for twelve
 * hundred rows and the console for a dropdown nobody can use. Refusing names the
 * setting to fix; truncating silently would leave a bookkeeper scrolling for a
 * month that was never rendered.
 */
const MAX_PERIODS = 240

/** The posting type that closes a month. */
const MONTH_END = 'month_end_inventory'

/**
 * Every month from the accounting cutoff to now, with its state.
 *
 * Oldest first, so the console's "earliest open month" is simply the first
 * `open` entry and no caller has to know the sort order.
 *
 * @param db The database handle. Reads only.
 * @param organizationId The organization whose books these are.
 * @returns The strip, or an {@link UnprocessableEntityError} naming the setting
 * to fix. An organization that has not finished setup has no cutoff yet and gets
 * an EMPTY strip rather than an error - the console renders the setup checklist
 * in that case, and refusing here would make "you have not started" look like a
 * failure.
 */
export async function listClosePeriods(
  db: Database,
  organizationId: string
): Promise<Result<ClosePeriod[], Error>> {
  try {
    const cutoff = readText(
      await getOrganizationSetting({
        organizationId,
        key: OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
      })
    )
    const bookTimeZone = readText(
      await getOrganizationSetting({
        organizationId,
        key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
      })
    )

    // Setup has not been done. Not an error: the module home renders the
    // checklist, and there is genuinely no month to show yet.
    if (!cutoff || !bookTimeZone) return ok([])

    const months = monthsAfter(cutoff, bookTimeZone)
    if (months.length === 0) return ok([])

    const lockedThrough = readText(
      await getOrganizationSetting({ organizationId, key: PERIOD_LOCK_SETTING_KEY })
    )

    const effective = await loadEffectivePostings(db, organizationId, months)

    return ok(
      months.map((periodKey) => {
        const posting = effective.get(periodKey)
        return {
          periodKey,
          state: resolveState(periodKey, posting, lockedThrough),
          glPostingId: posting?.id ?? null,
          docNumber: posting?.docNumber ?? null,
          totalMinor: posting?.totalMinor ?? null,
          postedAt: posting?.postedAt ? posting.postedAt.toISOString() : null,
          revision: posting?.revision ?? 0,
        }
      })
    )
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** The effective posting for one month, or nothing. */
interface EffectivePosting {
  id: string
  docNumber: string
  totalMinor: number
  postedAt: Date | null
  revision: number
  status: string
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

/**
 * A settings value as a non-empty trimmed string, or `null`.
 *
 * A settings form that clears a text input writes `''` rather than deleting the
 * row, so both spellings of "nothing is set" have to collapse to the same
 * answer. `period-lock.ts` makes the same call for the same reason.
 */
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The month after `monthKey`. */
function nextMonth(monthKey: string): string {
  const { year, month } = parsePeriodKey(monthKey)
  const nextYear = month === 12 ? year + 1 : year
  const next = month === 12 ? 1 : month + 1
  return `${String(nextYear).padStart(4, '0')}-${String(next).padStart(2, '0')}`
}

/**
 * The effective month-end posting per period.
 *
 * Excludes `reversed` rows in SQL, then keeps the highest `revision` per period.
 * Both halves are needed: excluding reversed rows alone would still leave two
 * live rows if a reversal were itself superseded, and taking the max revision
 * alone would treat a reversed original as current.
 */
async function loadEffectivePostings(
  db: Database,
  organizationId: string,
  months: string[]
): Promise<Map<string, EffectivePosting>> {
  const rows = await db
    .select({
      id: schema.GlPosting.id,
      periodKey: schema.GlPosting.periodKey,
      docNumber: schema.GlPosting.docNumber,
      totalMinor: schema.GlPosting.totalMinor,
      postedAt: schema.GlPosting.postedAt,
      revision: schema.GlPosting.revision,
      status: schema.GlPosting.status,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, MONTH_END),
        inArray(schema.GlPosting.periodKey, months),
        ne(schema.GlPosting.status, 'reversed')
      )
    )

  const byPeriod = new Map<string, EffectivePosting>()
  for (const row of rows) {
    const held = byPeriod.get(row.periodKey)
    if (!held || row.revision > held.revision) byPeriod.set(row.periodKey, row)
  }
  return byPeriod
}

/**
 * One month's state.
 *
 * Lock is checked FIRST. A month that is both posted and locked reads as
 * `locked`, because that is the fact that changes what a reader may do: a posted
 * month can still be reversed, and a locked one cannot be written to at all
 * until somebody unlocks it.
 */
function resolveState(
  periodKey: string,
  posting: EffectivePosting | undefined,
  lockedThrough: string | null | undefined
): ClosePeriod['state'] {
  if (lockedThrough && isMonthKey(lockedThrough) && compareMonths(periodKey, lockedThrough) <= 0) {
    return 'locked'
  }
  // Only a row that actually reached the books counts as posted. A `pending` or
  // `failed` claim is an OPEN month with an unfinished attempt in it, which is
  // what `listUnpostedPeriods` reports separately and what the console's banner
  // reads. Calling it posted here would hide the one thing the operator has to
  // act on.
  if (posting?.status === 'posted') return 'posted'
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

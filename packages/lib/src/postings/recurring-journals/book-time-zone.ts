// packages/lib/src/postings/recurring-journals/book-time-zone.ts

/**
 * The one zone this module is allowed to know about.
 *
 * 🛑 **A recurring journal rule has ONE boundary authority and it is
 * `accounting.bookTimeZone`** (task 21 §1.3). Both existing recurrence
 * consumers store the user's own zone on the rule, which is right for a visit
 * ("9am Tuesday, where the technician is") and wrong for an entry: the
 * accounting month is a wall-clock midnight in the book time zone, so a rule
 * carrying a browser-detected zone would put a December 31 entry into January
 * for a template that happened to be saved from one zone east. The column is
 * `NOT NULL`, so the book time zone is what goes in it, and this is the only
 * reader.
 *
 * Refuses rather than defaulting to UTC, for `opening-baseline.ts`'s reason: an
 * assumed zone posts a month's edge activity into the wrong period, invisibly,
 * and uncorrectably once the period is locked.
 */

import { UnprocessableEntityError } from '../../errors'
import { getOrganizationSetting } from '../../settings/settings-service'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup-readiness'

/**
 * `accounting.bookTimeZone`, validated as a real IANA zone.
 *
 * Validation is the one the platform already performs - `Intl.DateTimeFormat`
 * throws `RangeError` on an unrecognised zone - which is exactly the call
 * `periodKeyForDate` and `expandOccurrences` make later, so a value that
 * passes here cannot fail there.
 *
 * @throws {UnprocessableEntityError} when it is unset or not a real zone.
 */
export async function readBookTimeZone(organizationId: string): Promise<string> {
  const key = OPENING_BASELINE_SETTING_KEYS.bookTimeZone
  const raw = await getOrganizationSetting({ organizationId, key })
  const trimmed = typeof raw === 'string' ? raw.trim() : ''

  if (!trimmed) {
    throw new UnprocessableEntityError(
      'This organization has no book time zone, so there is no month boundary to schedule ' +
        `entries against. Set ${key} in Accounting settings first.`,
      { organizationId, setting: key }
    )
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed })
  } catch {
    throw new UnprocessableEntityError(
      `The book time zone for this organization is not a recognised IANA zone: "${trimmed}". ` +
        `Set ${key} to a zone such as America/New_York.`,
      { organizationId, setting: key, value: trimmed }
    )
  }

  return trimmed
}

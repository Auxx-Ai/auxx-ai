// packages/lib/src/postings/period-lock.ts
//
// Where `PeriodLock.lockedThroughMonth` comes from.
//
// `periods.ts` is pure on purpose: `isPeriodLocked` and `assertPeriodOpen` take
// the lock as an ARGUMENT so that module stays exhaustively testable with no
// database. That leaves exactly one thing owed, and this file is it - the single
// caller that resolves the lock once so every check can compare against it.
//
// ## Why the lock is one value and not two
//
// The lock has to mean the same thing in both modes auxx.ai runs in:
//
//   * **Ledger mode** - nothing is connected, or the provider is an exporter and
//     the books are ours. The lock is entirely ours: it is the month an
//     accountant declared closed inside auxx.ai.
//   * **Subledger mode** - a provider holds the books. The lock should track the
//     PROVIDER's own closed book, because posting into a month QuickBooks has
//     closed is refused there anyway, and a period auxx.ai thinks is open while
//     the provider has closed it produces a `failed` posting for a reason no
//     bookkeeper can act on from this side.
//
// One setting covers both because the question is the same question: is this
// month still accepting entries. What differs is who WRITES the setting - a
// human in ledger mode, and eventually a provider sync in subledger mode - and
// that difference belongs to the writer, not to every reader. This is the point
// `periods.ts` makes in the JSDoc on `PeriodLock.lockedThroughMonth`.

import { UnprocessableEntityError } from '../errors'
import { getOrganizationSetting } from '../settings/settings-service'
import { type PeriodLock, parsePeriodKey } from './periods'

/** The catalog key this module owns. `'2026-07'`, or unset for "nothing closed". */
export const PERIOD_LOCK_SETTING_KEY = 'ledger.lockedThroughMonth' as const

/**
 * Resolve one organization's period lock.
 *
 * Returns `{ lockedThroughMonth: null }` when nothing has been closed yet, which
 * is the state every organization starts in and the state most of them stay in
 * until their first close.
 *
 * ## This fails CLOSED, and that is the whole point
 *
 * The catalog cannot enforce the shape: `ledger.lockedThroughMonth` is a `TEXT`
 * setting and `FieldOptions` carries no pattern member, so a bad value can reach
 * this function - hand-edited, imported, or written by a future provider sync
 * that formats a month differently. There are two possible readings of a value
 * that is not `YYYY-MM`:
 *
 *   * **Fail open** - treat it as `null`, meaning "nothing is closed". Every
 *     posting is then allowed, including into a month an accountant has already
 *     closed and filed numbers for. Nothing downstream can detect it: the entry
 *     balances, the claim succeeds, and the discrepancy surfaces months later as
 *     a prior period that no longer ties to the statements that were issued from
 *     it. There is no un-post.
 *   * **Fail closed** - throw. Posting stops for that organization until someone
 *     fixes one settings row, which is a loud, immediate, five-second repair.
 *
 * The second failure is recoverable and the first one is not, so this throws.
 * It is the same call `resolveRoles` makes on an unresolvable role, and the same
 * call `parsePeriodKey` makes on a malformed key.
 *
 * ## Why it throws rather than returning a `Result`
 *
 * It pairs with `assertPeriodOpen`, which throws, and it is called from the
 * poster's single try/catch that maps every pre-claim refusal onto a
 * `PostResult` status. Returning a `Result` here would put a second error
 * protocol on one straight-line path for no gain. `postEntry` still never
 * throws; this is inside its guard.
 *
 * @param organizationId The organization whose books are being posted to.
 * @throws {UnprocessableEntityError} when the stored value is present but is not
 * a `YYYY-MM` month naming a real calendar month.
 */
export async function resolvePeriodLock(organizationId: string): Promise<PeriodLock> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: PERIOD_LOCK_SETTING_KEY,
  })

  // Unset, cleared, or whitespace. A settings form that clears a text input
  // writes `''` rather than deleting the row, so both spellings of "nothing is
  // closed" have to land in the same place.
  if (raw == null) return { lockedThroughMonth: null }

  if (typeof raw !== 'string') {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is not a month: ${describe(raw)}. ` +
        'Set ledger.lockedThroughMonth to a YYYY-MM month, or clear it if nothing is closed. ' +
        'Posting is refused until it is one or the other.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY }
    )
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) return { lockedThroughMonth: null }

  // `parsePeriodKey` owns the keyspace, so the validation is not duplicated
  // here. It accepts a DAY key too, which this setting must not: a lock is by
  // month (`isPeriodLocked` compares months), so `'2026-07-15'` has no meaning -
  // it either locks all of July or none of it, and silently picking one is the
  // fail-open reading in a different costume.
  let granularity: string
  try {
    granularity = parsePeriodKey(trimmed).granularity
  } catch {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is not a valid month: "${trimmed}". ` +
        'Set ledger.lockedThroughMonth to a YYYY-MM month, or clear it if nothing is closed. ' +
        'Posting is refused until it is one or the other.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY, value: trimmed }
    )
  }

  if (granularity !== 'month') {
    throw new UnprocessableEntityError(
      `The accounting period lock for this organization is a date, not a month: "${trimmed}". ` +
        'Periods close by month. Set ledger.lockedThroughMonth to YYYY-MM.',
      { organizationId, setting: PERIOD_LOCK_SETTING_KEY, value: trimmed }
    )
  }

  return { lockedThroughMonth: trimmed }
}

/** A non-string setting value, rendered short enough to put in a message. */
function describe(value: unknown): string {
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return `${typeof value} ${JSON.stringify(value)}`
}

// packages/lib/src/postings/next-account-code.ts

/**
 * Pick the code a newly minted account should carry, out of a declared band
 * (`plans/accounting/tasks/26-a-clearing-account-per-rail.md` §7.1).
 *
 * PURE. No database - the caller hands in the chart it has already read, which
 * is the same chart the uniqueness gate in `chart-write.ts` checks against.
 *
 * ## Why this is not "the highest plus one"
 *
 * 🛑 A band is a range, not a cursor. `1200-1249` is asset clearing and
 * `1250` onwards is somebody else's numbering; an org that once minted `1249`
 * and later removed `1205` would, under "highest plus one", walk straight out
 * of the band and number a clearing account into whatever the chart uses next.
 * So the walk is from the FLOOR of the band, and a full band is a refusal
 * rather than an overflow.
 *
 * ## Why a chart with no codes gets no code
 *
 * 🛑 `gl_account_code` became OPTIONAL in task 15 §5, and a chart imported from
 * a provider shipped with account numbering off carries none at all. Inventing
 * `1200` for that org would put the one numbered account in a chart of
 * forty named ones, and every screen that sorts by code would then sort it
 * first. An org that chose not to have a numbering scheme does not get one
 * invented for it: the name carries the account, exactly as it does for every
 * other account in that chart.
 *
 * ⚠️ The question asked is "does this chart use codes AT ALL", not "does it use
 * codes in this band". §7.1's two clauses read as though it were the latter,
 * but a chart numbered `1000`/`1100`/`1400` with nothing yet in `1200-1249` is
 * plainly a numbered chart, and the first clearing account it mints belongs at
 * `1200`. An empty BAND is a free band; an empty CHART is an unnumbered one.
 *
 * No permission checks here, and nothing that touches io.
 */

import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../errors'
import type { AccountCodeBand } from './default-chart'

/** The shape this reads off a chart row. `ChartAccountRow` satisfies it. */
export interface CodedAccount {
  code: string | null
}

/**
 * The first free code in `band`, or `null` when the chart carries no codes.
 *
 * `accounts` should be the chart as the uniqueness gate sees it - the LIVE
 * accounts, archived excluded. `assertCodeIsFree` (`chart-write.ts`) treats an
 * archived account's code as free, deliberately, so an allocator that counted
 * archived rows as taken would skip codes the writer would have accepted.
 *
 * Codes are compared as TRIMMED STRINGS, not as numbers, because that is what
 * uniqueness is actually checked on: `gl_account_code` is a `FieldValue.valueText`
 * and `assertCodeIsFree` matches it with `eq`. So `'01200'` and `'1200'` are two
 * different codes here for the same reason they are two different codes there.
 * A non-numeric code (`'CASH'`, `'1200-A'`) occupies no slot in any band and
 * blocks nothing, but it does count as the chart using codes.
 *
 * @returns `ok(code)` with the first free code; `ok(null)` when no account in
 *   the chart carries a code at all; `err(UnprocessableEntityError)` when every
 *   code in the band is taken.
 */
export function nextAccountCode(
  band: AccountCodeBand,
  accounts: readonly CodedAccount[]
): Result<string | null, Error> {
  const taken = new Set<string>()
  for (const account of accounts) {
    const code = account.code?.trim()
    if (code) taken.add(code)
  }

  // An unnumbered chart. Not a failure and not a gap to fill - see the header.
  if (taken.size === 0) return ok(null)

  for (let candidate = band.start; candidate <= band.end; candidate++) {
    const code = String(candidate)
    if (!taken.has(code)) return ok(code)
  }

  return err(
    new UnprocessableEntityError(
      `Every account code in the ${band.label} band is already in use, so there is no number left to give this account. Renumber or remove one of them, or create the account by hand with a code of your own.`,
      { band: band.label }
    )
  )
}

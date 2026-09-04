// packages/lib/src/banking/import/match-key.ts

/**
 * The identity an imported statement line carries.
 *
 * 🛑 **`matchKey` is NOT shaped here.** It is
 * {@link normalizeMatchKey} from `banking/feed/match-key.ts` (HANDOFF slot 3A),
 * imported rather than reimplemented, and that is the whole point:
 * Stripe's `fctxn_…`, an OFX `FITID` and a CSV row hash are three keyspaces for
 * one event, and `matchKey` is the ONLY thing that spans them
 * (plans/bank-connection/05-file-import.md §6). Two normalisers that disagreed by
 * so much as a stripped trailing digit would turn the overlap band 01 §4.1
 * deliberately creates - a file covering up to the cutover, the API reaching 180
 * days back, and the two overlapping so there is no hole - into two rows for
 * every transaction in it instead of one linked pair.
 *
 * It is re-exported below under the spelling this module's callers use, so there
 * is one implementation and one import site to change if the feed's file moves.
 */

import { normalizeMatchKey } from '../feed/match-key'

export { normalizeMatchKey }

/**
 * `description` normalised into the cross-source grouping key.
 *
 * An alias for the connector's {@link normalizeMatchKey}, nothing more. See that
 * function for every strip rule and why each one is a judgement call.
 */
export const normaliseMatchKey = normalizeMatchKey

/**
 * The deterministic id an imported row carries when the file gave it none.
 *
 * OFX hands over a `FITID`; **CSV carries nothing** (05 §4), so a re-import of
 * the same file would duplicate every row. The composite below is that section's
 * design: `(account, date, amountMinor, normalisedDescription, rowOrdinal)`.
 *
 * 🛑 **`ordinal` is the load-bearing part, and it is the subtle one.** A business
 * can legitimately have two identical transactions on the same day for the same
 * amount to the same payee - two $50 fuel purchases - and a key without a
 * per-(day, amount, payee) ordinal collapses them into one, which **silently
 * loses money from the ledger**. The ordinal counts how many earlier rows in the
 * SAME file already produced this triple, so re-importing the file reproduces
 * exactly the same ids and the importer updates instead of duplicating.
 *
 * ⚠️ The account id is part of the key because `bank_transaction.externalId` is
 * `isUnique` across the org, and two accounts at the same bank routinely carry
 * the same $50 fuel purchase on the same day.
 *
 * ⚠️ It is readable rather than hashed on purpose. A hash would be shorter and
 * would need `node:crypto`, which would put this function out of the browser's
 * reach; and when a duplicate does turn up, `imp:acc_x:20260115:-12450:acme-supply-co:0`
 * says what it is where a 16-hex digest says nothing.
 */
export function buildImportedExternalId(params: {
  bankAccountId: string
  postedAt: string
  amountMinor: number
  matchKey: string
  ordinal: number
}): string {
  const { bankAccountId, postedAt, amountMinor, matchKey, ordinal } = params
  const payee = matchKey.replace(/ /g, '-').slice(0, 40) || 'no-description'
  return ['imp', bankAccountId, postedAt.replace(/-/g, ''), amountMinor, payee, ordinal].join(':')
}

/**
 * Assign {@link buildImportedExternalId} to every row of a file that needs one.
 *
 * Pure, and separate from the write path, because the ordinal only makes sense
 * over the WHOLE file: computing it per row as the executor walks them would
 * give the second $50 fuel purchase the same ordinal as the first, which is the
 * collapse this exists to prevent.
 *
 * A row with no date or no amount gets `null` rather than a partial id - it has
 * no identity to derive one from, and inventing one would make two unusable rows
 * of a broken file the same row.
 */
export function assignImportedExternalIds<
  T extends {
    externalId?: string | null
    postedAt: string | null
    amountMinor: number | null
    description?: string | null
  },
>(
  bankAccountId: string,
  rows: readonly T[]
): (T & { externalId: string | null; matchKey: string })[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const matchKey = normalizeMatchKey(row.description)
    if (row.externalId) return { ...row, externalId: row.externalId, matchKey }
    if (!row.postedAt || row.amountMinor == null) return { ...row, externalId: null, matchKey }

    const triple = `${row.postedAt}|${row.amountMinor}|${matchKey}`
    const ordinal = seen.get(triple) ?? 0
    seen.set(triple, ordinal + 1)
    return {
      ...row,
      matchKey,
      externalId: buildImportedExternalId({
        bankAccountId,
        postedAt: row.postedAt,
        amountMinor: row.amountMinor,
        matchKey,
        ordinal,
      }),
    }
  })
}

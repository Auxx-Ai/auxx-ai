// packages/lib/src/postings/doc-number.ts

/**
 * The document number of one journal entry - **ours**.
 *
 * PURE. No database, no provider, no clock. Same posting identity in, same
 * string out, forever.
 *
 * ## Why this lives in `postings/` and not in the QuickBooks adapter
 *
 * It used to live in `money/quickbooks/post-journal-entry.ts`, which read as
 * reasonable while the only consumer was a QuickBooks push. It is not: a
 * document number is written to `GlPosting.docNumber` **whether or not a
 * provider exists**, it is decision `P2`'s deterministic natural key, and the
 * poster's layer-2 heal ("QuickBooks already holds this entry but our id map
 * does not") is a query BY this string. An org with nothing connected still
 * mints one, and an org that swaps QuickBooks for something else keeps every
 * one it has already minted. That makes it ledger vocabulary, beside the period
 * keyspace, and the adapter a consumer of it.
 *
 * The 21-character cap IS QuickBooks' `DocNumber` limit, adopted as ours on
 * purpose: a value that fits everywhere stays portable, and picking it up later
 * would mean re-minting keys that are already in a ledger.
 *
 * ## The shape
 *
 * ```
 *   AUXX-<TYPE>-<key>[-R<revision>]
 *   └─5─┘└─3──┘└────────12─────────┘   = 21 max
 * ```
 *
 * @see plans/money/04-books.md for the posting model
 */

import { UnprocessableEntityError } from '../errors'
import type { PostingType } from './types'

/**
 * QuickBooks caps `DocNumber` at 21 characters, and we adopt that as OUR cap.
 *
 * 🛑 Over-length is a REFUSAL, not a truncation - see {@link buildDocNumber}.
 */
export const DOC_NUMBER_MAX_LENGTH = 21

/**
 * Three letters per posting type. Every member of `POSTING_TYPES`, including
 * the two the L3 per-event regime writes and does not yet enable.
 *
 * Pinned to `POSTING_TYPES` by an exact-key-equality test: a new posting
 * type with no prefix would otherwise mint `AUXX-undefined-…`, which is a
 * perfectly valid string that collides with every other new type.
 */
export const DOC_NUMBER_PREFIX: Record<PostingType, string> = {
  fulfillment: 'FUL',
  payout: 'PAY',
  build: 'BLD',
  month_end_deferral: 'DEF',
  month_end_reversal: 'REV',
  month_end_inventory: 'INV',
  receipt: 'RCP',
  vendor_bill: 'BIL',
  // Wave 0 (HANDOFF slot 0B). All five key on a DOCUMENT NUMBER, never a date
  // and never a cuid - see `DocNumberInput.periodKey`.
  manual_journal: 'JNL',
  opening_balance: 'OPB',
  bank_transaction: 'BNK',
  bank_deposit: 'DEP',
  write_off: 'WOF',
  // `PAY` is the payout's. A payment keys on a short hash of the transaction
  // id (`PMT-<6 base36>`), never a counted sequence: two concurrent payments
  // minting one key would converge the loser to `already_posted`, a SUCCESS,
  // silently merging two payments into one entry.
  payment: 'PMT',
  // 🛑 `INV` is `month_end_inventory`'s and cannot be reused - documents
  // already carry it. An issuance entry keys on the INVOICE NUMBER, compacted,
  // exactly as `manual_journal`, `bank_deposit` and `write_off` key on their
  // own record's number, so one entry per invoice falls out of the claim index.
  invoice_issued: 'INI',
  // A deposit application keys on a short hash of the ALLOCATION row's id
  // (`DPA-<6 base36>`), for the reason spelled out at length in
  // `build-payment-entry.ts`: a counted sequence lets two concurrent
  // applications mint one key, and the loser converges to `already_posted` - a
  // SUCCESS - with one customer's money folded into another's entry.
  deposit_application: 'DPA',
}

/** What identifies one entry of one type. See {@link buildDocNumber}. */
export interface DocNumberInput {
  postingType: PostingType
  /**
   * `GlPosting.periodKey` verbatim - and it is NOT always a period.
   *
   * 🛑 **Two types key on an id rather than a date, and both rules are
   * load-bearing:**
   *
   * - **`build`** keys on the build's own **`build.number`** (`'BLD-0007'`),
   *   never its cuid. Two builds can complete on one day, so a date key would
   *   silently swallow the second - and `AUXX-BLD-<cuid>` is **33 characters**,
   *   which this function refuses outright.
   * - **`payout`** keys on the **payout id**, never a date. Shopify can issue
   *   two payouts in a day; a date key merges them into one entry whose total
   *   ties to neither deposit, and the reconciliation of 1200 Shopify Clearing
   *   is exactly the thing that then cannot be done.
   *
   * - **`manual_journal`**, **`bank_deposit`**, **`write_off`** and
   *   **`bank_transaction`** key on the source record's own **number**
   *   (`'JE-0007'`, `'DEP-0003'`), for the same reason a build does: many can
   *   post in one day, and a cuid is over the cap. `opening_balance` keys on
   *   the cutover date, because an org has exactly one.
   *
   * Everything else keys on a real period - `'2026-08-18'` for a day,
   * `'2026-08'` for a month. Hyphens are stripped, so both compact to 8 and 6.
   */
  periodKey: string
  /**
   * `GlPosting.revision`. 0 for the original; a reversal of revision N claims
   * N+1.
   *
   * 🛑 **The `-R<revision>` suffix is REQUIRED, not cosmetic.**
   * `GlPosting_org_docNumber_key` is unique per org, so a reversal sharing its
   * original's document number is a constraint violation - the reversal simply
   * cannot be written. It is also what a bookkeeper reads in the register to
   * tell the pair apart.
   */
  revision?: number
}

/**
 * Mint the deterministic document number for one entry.
 *
 * 🛑 **Refuses rather than truncates.** The old implementation ended in
 * `.slice(0, 21)`, which is the more dangerous half of the cap: a document
 * number is a natural key, two long keys can truncate to the SAME string, and
 * the unique index then rejects the second entry with a message about a
 * duplicate that a reader cannot connect to a length limit. Worse, a silent
 * truncation of a build number would make two builds' entries indistinguishable
 * in the provider's register. Failing here names the input.
 *
 * @throws {UnprocessableEntityError} on an unknown posting type, a blank key, a
 * negative revision, or a composed value over {@link DOC_NUMBER_MAX_LENGTH}.
 */
export function buildDocNumber(input: DocNumberInput): string {
  const { postingType, periodKey, revision = 0 } = input

  const prefix = DOC_NUMBER_PREFIX[postingType]
  if (!prefix) {
    throw new UnprocessableEntityError(
      `No document-number prefix is declared for posting type '${postingType}'`,
      { postingType }
    )
  }

  const compact = periodKey.replace(/-/g, '')
  if (compact.length === 0) {
    throw new UnprocessableEntityError(
      `A ${postingType} posting needs a period key to key its document number on`,
      { postingType, periodKey }
    )
  }

  if (!Number.isInteger(revision) || revision < 0) {
    throw new UnprocessableEntityError(
      `Posting revision must be a non-negative integer, got ${String(revision)}`,
      { postingType, periodKey, revision: String(revision) }
    )
  }

  // Revision 0 carries NO suffix: it is the original, and every document number
  // already minted is suffix-less. Adding one would re-key the whole ledger.
  const suffix = revision > 0 ? `-R${revision}` : ''
  const docNumber = `AUXX-${prefix}-${compact}${suffix}`

  if (docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new UnprocessableEntityError(
      `Document number '${docNumber}' is ${docNumber.length} characters, over the ${DOC_NUMBER_MAX_LENGTH}-character cap. ` +
        'A build keys on `build.number` and a payout on the payout id - never on a cuid, which is 24 characters on its own.',
      { postingType, periodKey, revision: String(revision), length: String(docNumber.length) }
    )
  }

  return docNumber
}

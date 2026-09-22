// packages/lib/src/accounting/ledger/builders/doc-number.ts

/**
 * The document number of one journal entry. PURE: same posting identity in,
 * same string out, forever. It is written to `GlPosting.docNumber` whether or
 * not a provider is connected, and the QuickBooks adapter queries by it, so it
 * is ledger vocabulary and the adapter a consumer of it.
 *
 * Three kinds of period key, three renderings ({@link DOC_NUMBER_KIND}):
 *
 * ```
 *   document  BILL-000123[-G<gen>][-R<rev>]   the record's own number, verbatim
 *   hash      PMT-80DBIZ[-R<rev>]             `hashedPeriodKey` output, verbatim
 *   calendar  DEF-202703[-R<rev>]             <PREFIX>-<key, dashes stripped>
 * ```
 *
 * A row minted before plans/accounting/tasks/80 carries `AUXX-<PREFIX>-<key>`
 * and keeps it; a reversal appends `-R<n>` to whatever the original carries.
 */

import { UnprocessableEntityError } from '../../../errors'
import type { PostingType } from '../types'

/** QuickBooks caps `DocNumber` at 21 characters, adopted as ours. Over-length refuses, never truncates. */
export const DOC_NUMBER_MAX_LENGTH = 21

/** A document-keyed period key's budget: the cap less a repost (`-G9`) and a reversal (`-R9`) suffix. */
export const DOCUMENT_KEY_MAX_LENGTH = DOC_NUMBER_MAX_LENGTH - '-G9'.length - '-R9'.length

/**
 * Was this period key minted by the retired batch lanes' group hash?
 *
 * Kept for `periods.ts`, which refuses to parse one as a calendar key. Nothing
 * mints these any more; a pre-migration row can still carry one.
 */
export function isGroupPeriodKey(periodKey: string): boolean {
  return /^g[0-9a-z]{8}$/.test(periodKey)
}

/**
 * Three letters per posting type. Pinned to `POSTING_TYPES` by an exact-key
 * test: a type with no prefix would mint `undefined-…` and collide with every
 * other new type.
 */
export const DOC_NUMBER_PREFIX: Record<PostingType, string> = {
  fulfillment: 'FUL',
  payout: 'PAY',
  month_end_deferral: 'DEF',
  month_end_reversal: 'REV',
  inventory_movement: 'INV',
  refund: 'RFD',
  // Keys on `vendor_bill_internal_number`, ours: the vendor's own number is not
  // unique in our org, and two bills on one key converge the loser to
  // `already_posted` with its payable never recorded.
  vendor_bill: 'BIL',
  manual_journal: 'JNL',
  opening_balance: 'OPB',
  bank_transaction: 'BNK',
  bank_deposit: 'DEP',
  write_off: 'WOF',
  // Hash-keyed types never use a counted sequence: two concurrent rows minting
  // one key would converge the loser to `already_posted`, a SUCCESS, and merge
  // two events into one entry. See `hashedPeriodKey` for the collision caveat.
  payment: 'PMT',
  vendor_payment: 'VPM',
  vendor_refund: 'VRF',
  // `INV` is `inventory_movement`'s.
  invoice_issued: 'INI',
  deposit_application: 'DPA',
  credit_memo: 'CRM',
  // Keys on `vendor_credit_number`, ours, for the reason `vendor_bill` does.
  vendor_credit: 'VCR',
  // Keys on the provider's own transaction id, the only identity an entry we
  // did not author has. QuickBooks' `Id` is numeric and at most 11 characters,
  // so `SYN-<id>-R9` always fits.
  provider_sync: 'SYN',
  recurring_journal: 'RJE',
  landed_cost_clear: 'LCC',
}

/** Which rendering a posting type's period key takes. See the header. */
export type DocNumberKind = 'document' | 'hash' | 'calendar'

/**
 * How each type keys, pinned to `POSTING_TYPES` like the prefix map.
 * `document`: a `RecordSequence` number, possibly with a builder suffix
 * (`ORD-0012-F1`). `hash`: a `hashedPeriodKey`-shaped `<PFX>-<fold>`, prefix
 * included. `calendar`: a day, a month, or the provider's own id.
 */
export const DOC_NUMBER_KIND: Record<PostingType, DocNumberKind> = {
  fulfillment: 'document',
  payout: 'document',
  month_end_deferral: 'calendar',
  month_end_reversal: 'calendar',
  inventory_movement: 'hash',
  vendor_bill: 'document',
  manual_journal: 'document',
  opening_balance: 'calendar',
  bank_transaction: 'hash',
  bank_deposit: 'document',
  write_off: 'document',
  payment: 'hash',
  refund: 'hash',
  vendor_payment: 'hash',
  vendor_refund: 'hash',
  invoice_issued: 'document',
  deposit_application: 'hash',
  credit_memo: 'document',
  provider_sync: 'calendar',
  recurring_journal: 'hash',
  vendor_credit: 'document',
  landed_cost_clear: 'hash',
}

/** What identifies one entry of one type. See {@link buildDocNumber}. */
export interface DocNumberInput {
  postingType: PostingType
  /**
   * `GlPosting.periodKey` verbatim. A document-keyed type carries its record's
   * own number (`'BILL-0002'`, `'ORD-0012-F1'`); a hash-keyed type a
   * `hashedPeriodKey`; a calendar-keyed type `'2026-08-18'`, `'2026-08'`, or
   * the provider's transaction id.
   */
  periodKey: string
  /**
   * `GlPosting.revision`. 0 for the original; a reversal of revision N claims
   * N+1 and renders `-R<N+1>`, which is what keeps `GlPosting_org_docNumber_key`
   * satisfiable for the pair.
   */
  revision?: number
}

/**
 * Mint the deterministic document number for one entry.
 *
 * Refuses rather than truncates: two long keys can truncate to one string and
 * the unique index then reports a duplicate a reader cannot connect to a
 * length limit. A document-keyed key is checked against
 * {@link DOCUMENT_KEY_MAX_LENGTH} at revision 0 so it still fits once reposted
 * and reversed; the 21-character check on the final string is the backstop.
 *
 * @throws {UnprocessableEntityError} on an unknown posting type, a blank key, a
 * negative revision, or a value over the cap.
 */
export function buildDocNumber(input: DocNumberInput): string {
  const { postingType, periodKey, revision = 0 } = input

  const prefix = DOC_NUMBER_PREFIX[postingType]
  const kind = DOC_NUMBER_KIND[postingType]
  if (!prefix || !kind) {
    throw new UnprocessableEntityError(
      `No document-number prefix is declared for posting type '${postingType}'`,
      { postingType }
    )
  }

  const key = periodKey.trim()
  if (key.length === 0) {
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

  // The budget is the record's number alone: a repost arrives with `-G<n>` already on the key.
  const number = kind === 'document' ? key.replace(/-G\d+$/, '') : key
  if (kind === 'document' && revision === 0 && number.length > DOCUMENT_KEY_MAX_LENGTH) {
    throw new UnprocessableEntityError(
      `Document key '${number}' is ${number.length} characters and a document number allows ` +
        `${DOCUMENT_KEY_MAX_LENGTH} (${DOC_NUMBER_MAX_LENGTH} total, less a repost and a reversal suffix).`,
      { postingType, periodKey, length: String(number.length) }
    )
  }

  const suffix = revision > 0 ? `-R${revision}` : ''
  const base = kind === 'calendar' ? `${prefix}-${key.replace(/-/g, '')}` : key
  const docNumber = `${base}${suffix}`

  if (docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new UnprocessableEntityError(
      `Document number '${docNumber}' is ${docNumber.length} characters, over the ${DOC_NUMBER_MAX_LENGTH}-character cap. ` +
        'Key on a short record number, never on a cuid.',
      { postingType, periodKey, revision: String(revision), length: String(docNumber.length) }
    )
  }

  return docNumber
}

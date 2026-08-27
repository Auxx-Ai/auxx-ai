// packages/lib/src/postings/types.ts
//
// The shapes of a double-entry posting, ours.
//
// Decision P1 (plans/purchasing/README.md): auxx.ai is the system of record for
// purchase -> receipt -> bill -> posting, and the accounting system is an
// EXPORTER. Everything in this file therefore describes an entry that is
// complete and meaningful with NO provider connected at all. Nothing here names
// QuickBooks, and nothing here carries a provider's identifier.

/**
 * What produced a posting.
 *
 * The first six mirror the values already seeded on the `gl_posting` registry
 * enum (`resources/registry/enum-values.ts`); `receipt` and `vendor_bill` are
 * added by the purchasing work (build plan 7.5). This union is the module's own
 * copy on purpose: it is client-safe, and it lets the builders here be written
 * and tested before the registry enum migration lands. The two must be kept in
 * step - the registry enum is the storage contract, this is the code contract.
 */
export const POSTING_TYPES = [
  'fulfillment',
  'payout',
  'build',
  'month_end_deferral',
  'month_end_reversal',
  'month_end_inventory',
  'receipt',
  'vendor_bill',
] as const

export type PostingType = (typeof POSTING_TYPES)[number]

/** Which side of the entry a line sits on. The ONLY carrier of sign. */
export type PostingDirection = 'debit' | 'credit'

/**
 * One line of a double-entry posting, before it is persisted as a
 * `gl_posting_line` row.
 *
 * Two rules make this type worth having at all:
 *
 * 1. **`accountCode` is an account CODE - `'2160'` - never a provider account
 *    id.** This is decision P2 and the whole cash value of P1. A code is ours,
 *    it is stable, it means the same thing in every provider and in no provider,
 *    and it is what makes a posting replayable and auditable three years later
 *    without an API call. Code -> provider id resolution happens in exactly one
 *    place: `AccountingProvider.resolveAccount` inside an adapter.
 * 2. **`amount` is always POSITIVE**, integer minor units (cents), and
 *    `direction` carries the sign. Storing a signed amount AND a direction lets
 *    the two disagree - `{ amount: -500, direction: 'debit' }` is representable
 *    and every reader has to guess which half is authoritative. With a positive
 *    amount there is nothing to disagree about, and `SUM(amount) WHERE direction
 *    = 'debit'` is the balance check.
 */
export interface GlPostingLineInput {
  /** Account CODE, e.g. `'1310'`. Never a provider account id. See above. */
  accountCode: string
  direction: PostingDirection
  /** Integer minor units. Always > 0 - `direction` carries the sign. */
  amount: number
  /** Human-readable line memo. Never a lookup key. */
  memo?: string
  /**
   * The kind of row that produced this line - `'stock_movement'`,
   * `'vendor_bill'`. Required, with `sourceId`, because build plan 7.3 is
   * explicit that the pair is what makes a posting explainable later without
   * joining through a provider's API.
   */
  sourceType: string
  /** The id of the row that produced this line. The audit trail. */
  sourceId: string
  /** Stable presentation order within the entry. */
  sortOrder: number
}

/**
 * A balanced entry, built and validated but not yet persisted or pushed.
 *
 * `totalDebit === totalCredit` is guaranteed by construction: the only way to
 * obtain this type is `buildEntry`, which throws rather than return an
 * unbalanced one.
 */
export interface BuiltEntry {
  postingType: PostingType
  /** `'2026-08-18'` for a day, `'2026-08'` for a month. See `periods.ts`. */
  periodKey: string
  /** `YYYY-MM-DD`. Always explicit - providers default to their own server date. */
  txnDate: string
  lines: GlPostingLineInput[]
  /** Integer minor units. Equal to `totalCredit`, always. */
  totalDebit: number
  /** Integer minor units. Equal to `totalDebit`, always. */
  totalCredit: number
}

/**
 * One entry handed to a provider for export.
 *
 * `idempotencyKey` is required and must be deterministic - derived from the
 * posting identity, never random. A random key guarantees nothing, because the
 * retry carries a different one. `packages/lib/src/money/quickbooks/post-journal-entry.ts`
 * documents why this matters: a double-posted journal entry silently misstates
 * the financial statements and nobody notices until a close does not tie out.
 */
export interface PostEntryInput {
  organizationId: string
  /** The `gl_posting` EntityInstance id this entry is recorded on - ours. */
  glPostingId: string
  postingType: PostingType
  periodKey: string
  txnDate: string
  /** Deterministic natural key, also written to the provider's document number. */
  docNumber: string
  lines: GlPostingLineInput[]
  /** Deterministic. The provider MUST be idempotent on this. */
  idempotencyKey: string
  memo?: string
}

/**
 * What happened to an entry at the provider.
 *
 * - `posted` - pushed for the first time.
 * - `already_posted` - the provider already held it; nothing was sent.
 * - `healed` - the provider held it but our id map did not, and we wrote the id
 *   back rather than posting again. This is the most valuable outcome in the
 *   set: it is the previous-run-crashed-after-posting case, and posting again
 *   would duplicate the entry.
 * - `not_connected` - there is no accounting system. The entry is built and
 *   persisted and simply never pushed. A first-class outcome, NOT an error.
 */
export type PostEntryStatus = 'posted' | 'already_posted' | 'healed' | 'not_connected'

/**
 * Result of handing one entry to a provider.
 *
 * Deliberately wider than build plan 7.4's `{ externalId: string }`: `none` and
 * `already_posted` have to be distinguishable from a fresh post by the caller
 * that stamps `gl_posting.status`, and a bare id cannot carry that. `externalId`
 * is empty exactly when `status` is `not_connected`.
 */
export interface PostEntryResult {
  status: PostEntryStatus
  /** The provider's own id for the entry. `''` when `status` is `not_connected`. */
  externalId: string
  /** Which provider answered - `'quickbooks'`, or `'none'`. */
  providerId: string
}

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
 * Mirrors the `GlPostingType` Postgres enum in
 * `packages/database/src/db/schema/gl-posting.ts`, which is the STORAGE
 * contract; this union is the CODE contract and the two must be kept in step.
 *
 * It is a separate copy on purpose: this file is client-safe and `@auxx/database`
 * is not. The `gl_posting` registry enum that used to be the third copy is gone -
 * entity migration 114 retired the def (task 11) - so there are two, and there
 * must never be a third. See plans/money/tasks/done/07-align-gl-foundation.md section 6.
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
 * 1. **`accountRole` is an auxx ROLE - `'grni'` - never an account number and
 *    never a provider account id.** Two indirections, stacked, answering
 *    different questions.
 *
 *    Decision `P2` is the outer one: what a persisted ledger line STORES is an
 *    account CODE, ours, so an entry stays replayable and auditable three years
 *    later with no API call - code -> provider id happens in exactly one place,
 *    `AccountingProvider.resolveAccount` inside an adapter.
 *
 *    Decision `G8` is the inner one, and it is why this field is a role rather
 *    than that code. `G7` makes the chart of accounts a seeded DEFAULT the org
 *    edits; once it is editable the number cannot carry the meaning, because a
 *    customer who renumbers GRNI from `2160` to `2155` would silently break
 *    every builder that hardcoded it - and the entry would still balance, so
 *    nothing downstream could detect it. So a builder emits a role, the org's
 *    own `gl_account` maps that role to a code, and the resolver in front of the
 *    claim fails CLOSED on zero matches and on more than one.
 *
 *    `BuiltEntry` therefore carries roles; {@link ResolvedPostingLine} carries
 *    the resolved code and the account name as it stood at the time. Both are
 *    snapshots, for the same reason a movement's cost is frozen.
 * 2. **`amount` is always POSITIVE**, integer minor units (cents), and
 *    `direction` carries the sign. Storing a signed amount AND a direction lets
 *    the two disagree - `{ amount: -500, direction: 'debit' }` is representable
 *    and every reader has to guess which half is authoritative. With a positive
 *    amount there is nothing to disagree about, and `SUM(amount) WHERE direction
 *    = 'debit'` is the balance check.
 */
export interface GlPostingLineInput {
  /**
   * auxx posting ROLE, e.g. `'grni'` - one of `ACCOUNT_ROLES` in
   * `build-entry.ts`. Never an account number, never a provider account id.
   * See above.
   */
  accountRole: string
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
 * One posting line after its role has been resolved against the org's own chart.
 *
 * This is the type that crosses the seam out of auxx: it is what a
 * `gl_posting_line` row stores and what a provider adapter is handed. **A
 * provider never sees a role** - by the time an entry reaches an adapter, every
 * `accountRole` has become one org's `accountCode`, or the post failed with
 * `account_unmapped` / `account_ambiguous` before the period was ever claimed.
 *
 * `accountName` is a SNAPSHOT of the account's name at posting time, not a live
 * read. Renaming `2160` next year must not rewrite last year's ledger, exactly
 * as a movement's frozen cost is not restated by a standard-cost change.
 */
export interface ResolvedPostingLine extends Omit<GlPostingLineInput, 'accountRole'> {
  /** Account CODE, e.g. `'1310'`, from the org's own chart. Never a provider id. */
  accountCode: string
  /** The account's name as it stood when the entry was posted. A snapshot. */
  accountName?: string
}

/**
 * One entry handed to a provider for export.
 *
 * `idempotencyKey` is required and must be deterministic - derived from the
 * posting identity, never random. A random key guarantees nothing, because the
 * retry carries a different one.
 * `packages/lib/src/money/quickbooks/quickbooks-accounting-provider.ts` documents
 * why this matters: a double-posted journal entry silently misstates
 * the financial statements and nobody notices until a close does not tie out.
 *
 * ⚠️ `lines` are POST-resolution ({@link ResolvedPostingLine}). An adapter is
 * handed codes and resolves each one to its own account id; it never sees, and
 * must never learn about, an auxx role.
 */
export interface PostEntryInput {
  organizationId: string
  /** The `GlPosting` row id this entry is recorded on - ours. Not an EntityInstance. */
  glPostingId: string
  /** `GlPosting.revision`. 0 for an original, N+1 for a reversal of revision N. */
  revision: number
  postingType: PostingType
  periodKey: string
  txnDate: string
  /** Deterministic natural key, also written to the provider's document number. */
  docNumber: string
  lines: ResolvedPostingLine[]
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
 * - `disabled` - there IS an integration and export is switched off at it. Also
 *   not an error, but NOT the same as `not_connected`, and the difference is the
 *   whole reason it is its own value: one is a setting somebody can flip, the
 *   other is a missing integration, and the close console has to tell a reader
 *   which of the two it is looking at. Leaving them merged would make the remedy
 *   unguessable from the record.
 */
export type PostEntryStatus = 'posted' | 'already_posted' | 'healed' | 'not_connected' | 'disabled'

/**
 * Result of handing one entry to a provider.
 *
 * Deliberately wider than build plan 7.4's `{ externalId: string }`: `none` and
 * `already_posted` have to be distinguishable from a fresh post by the caller
 * that stamps `GlPosting.status`, and a bare id cannot carry that. `externalId`
 * is empty exactly when nothing was pushed - `not_connected` or `disabled`.
 */
export interface PostEntryResult {
  status: PostEntryStatus
  /** The provider's own id for the entry. `''` when `status` is `not_connected`. */
  externalId: string
  /** Which provider answered - `'quickbooks'`, or `'none'`. */
  providerId: string
}

/**
 * Why one push failed, in the only terms the provider-agnostic core can act on.
 *
 * The core cannot classify a provider's failure itself: the thing that separates
 * a permanent fault from a transient one is the provider's own error vocabulary
 * (for QuickBooks, `Fault.Error[0].code`, which arrives as a NON-ENUMERABLE
 * property on the thrown error). So the adapter classifies and the core routes.
 *
 * - `configuration` - a setup problem. Never retried, and surfaced as a setup
 *   problem rather than a posting failure.
 * - `data` - a builder bug or a subledger inconsistency, e.g. an imbalance the
 *   provider rejected. Never retried; retrying cannot change the answer.
 * - `transport` - a rate limit, a 5xx, a timeout. Backed off and retried, capped.
 */
export type PostFailureClass = 'configuration' | 'data' | 'transport'

/**
 * A provider push that failed, carrying enough for the core to decide what next.
 *
 * `err(new Error(...))` alone is not enough: it forces the core to either retry
 * everything (double-posting risk on a fault that will never succeed) or retry
 * nothing (a rate limit becomes a permanent failure). Adapters return this.
 */
export class ProviderPostError extends Error {
  readonly failureClass: PostFailureClass
  /** The provider's own fault code when it carried one - `'2300'`, `'6140'`. */
  readonly faultCode?: string
  readonly providerId: string

  constructor(
    message: string,
    options: { failureClass: PostFailureClass; providerId: string; faultCode?: string }
  ) {
    super(message)
    this.name = 'ProviderPostError'
    this.failureClass = options.failureClass
    this.providerId = options.providerId
    this.faultCode = options.faultCode
  }

  /** Transport failures are the only ones worth trying again. */
  get retryable(): boolean {
    return this.failureClass === 'transport'
  }
}

/**
 * Every way `postEntry` can end. Wider than {@link PostEntryStatus}, which is
 * only what a PROVIDER can answer.
 *
 * The five provider statuses pass through unchanged. The rest are outcomes the
 * core reaches without ever calling a provider, and every one of them is a
 * return value rather than a throw - see {@link PostResult}.
 *
 * `already_posted` is a SUCCESS and must never be logged as an error. Logging a
 * routine converged re-run as a failure trains everyone to ignore the channel,
 * and the channel is the only warning a real double-post would arrive on.
 */
export type PostResultStatus =
  | PostEntryStatus
  | 'period_closed'
  | 'account_unmapped'
  | 'unbalanced'
  | 'error'

/**
 * What `postEntry` returns. It NEVER throws.
 *
 * Disabled, not-connected, a closed period, an unmapped role and every mid-chain
 * failure all resolve to a status here, so a BullMQ job or a tRPC mutation can
 * persist the outcome without its own try/catch. `sync-invoice.ts` is the shape.
 *
 * `glPostingId` is set whenever the claim succeeded or found an existing row -
 * so it is present on `already_posted`, and absent on the pre-claim refusals
 * (`period_closed`, `account_unmapped`, `unbalanced`), which is exactly the
 * distinction a caller needs to know whether anything was written.
 */
export interface PostResult {
  status: PostResultStatus
  /** The `GlPosting` row, once claimed. Absent on a pre-claim refusal. */
  glPostingId?: string
  /** Always set once the entry is built - it is minted before the claim. */
  docNumber?: string
  /** `'quickbooks'`, `'none'`, or absent when no provider was reached. */
  providerId?: string
  /** The provider's own id for the entry, once pushed. */
  providerEntryId?: string
  /** Human-readable. On `account_unmapped` it names EVERY offending role. */
  error?: string
  failureClass?: PostFailureClass
  /** `true` only for a transport failure. The retry decision, precomputed. */
  retryable?: boolean
}

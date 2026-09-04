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
import type { GlAccountTypeValue } from './default-chart'

export const POSTING_TYPES = [
  'fulfillment',
  'payout',
  'build',
  'month_end_deferral',
  'month_end_reversal',
  'month_end_inventory',
  'receipt',
  'vendor_bill',
  // Added by plans/accounting/HANDOFF.md wave 0 (slot 0B), 2026-09-04.
  // A bookkeeper's adjusting entry, coded by account CODE rather than role.
  'manual_journal',
  // The opening trial balance, posted once at cutover, dated the day before
  // `accounting.cutoffPeriod` begins. Names the three inventory accounts by
  // code, and is NOT an inventory writer: the month-end assertion subtracts
  // the opening baseline settings rather than reading this entry.
  'opening_balance',
  // A coded bank-feed line (bank plan 03). Matched lines post nothing.
  'bank_transaction',
  // Undeposited funds moved to cash as one line per bank run (tasks/06).
  'bank_deposit',
  // An invoice written off to bad debt.
  'write_off',
  // A customer payment or refund, posted from `PaymentTransaction`:
  // `Dr undeposited_funds | cash | clearing` (per `accounting.paymentRoute.*`)
  // / `Cr accounts_receivable`. Added for slot 2G phase B, 2026-09-04.
  'payment',
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
export interface GlPostingLineBase {
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
 * One line, in one of exactly TWO shapes, and never both at once.
 *
 * ⚠️ Widened from a bare `{ accountRole }` by HANDOFF slot 1A (2026-09-04).
 * Everything the file header says about roles still holds for a BUILDER, which
 * is the only thing that emits `{ accountRole }`. The second shape exists
 * because a human coding an adjusting entry is doing the opposite of what `G8`
 * describes: they are picking a specific account out of THEIR OWN chart, most
 * of which carries no role at all (13 roles across 35 accounts). `G8` protects
 * builders from a renumber; it has nothing to protect here, because the person
 * choosing the account is looking at the chart as it is right now.
 *
 * The precedent is `vendor_bill_line.glAccount`, which faced the identical
 * question and answered it the same way: it stores a CODE, because it is a
 * bookkeeper coding a line against their own chart.
 *
 * 🛑 **A code line does NOT get a cheaper resolver.** `resolveAccountLines`
 * validates a code against the org's chart with the same batched refusals it
 * applies to a role - missing, archived, inactive, ambiguous - so both shapes
 * fail closed identically and an entry naming six bad accounts fails once
 * naming six.
 *
 * The `?: never` legs are what make this a discriminated union that still reads
 * as one object: `line.accountRole` is `string | undefined` on the union rather
 * than a type error, so every existing reader narrows instead of breaking.
 */
export type GlPostingLineInput =
  | (GlPostingLineBase & {
      /**
       * auxx posting ROLE, e.g. `'grni'` - one of `ACCOUNT_ROLES` in
       * `build-entry.ts`. Never an account number, never a provider account id.
       * See above.
       */
      accountRole: string
      accountCode?: never
    })
  | (GlPostingLineBase & {
      /**
       * An account CODE out of this org's own chart, e.g. `'6300'`. Only a
       * human-authored entry (`manual_journal`, `opening_balance`) may use it.
       */
      accountCode: string
      accountRole?: never
    })

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
export interface ResolvedPostingLine extends GlPostingLineBase {
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
  | 'nothing_to_close'
  | 'setup_incomplete'
  // Wave 1 (HANDOFF slot 1A). A manual or opening entry named one of the three
  // inventory accounts by code; the remedy is the close console, which is the
  // only writer of those balances.
  | 'inventory_role_refused'
  // A code-based line names an account the org's chart does not hold, or holds
  // archived or inactive. The message names the row.
  | 'account_invalid'
  | 'error'

/**
 * The two refusals that are NOT failures, added 2026-08-28 by task 14.
 *
 * Both were previously reachable only as `error`, which is the one status a
 * screen has to treat as "something broke". They are the opposite: the two most
 * ordinary things an organization encounters.
 *
 * - `nothing_to_close` - every inventory balance and activity total is unchanged
 *   for the period, so there is no entry to build.
 *   `buildMonthEndInventoryEntry` throws `UnprocessableEntityError` on this
 *   deliberately (an empty line array would otherwise report "at least one
 *   line", which names the wrong thing), and the composer above it converts the
 *   throw into this status. An org whose cutoff predates its first movement
 *   walks through a run of these; the console SKIPS them, it does not alarm.
 * - `setup_incomplete` - there is no usable opening baseline, so there is nothing
 *   to compute a delta from. Two ways in: `accounting.setupState` is still a
 *   draft (the refusal every organization hits on day one), or it says finalized
 *   while required keys are blank. 🛑 The second is an anomaly - finalize is
 *   supposed to gate on completeness - but it is deliberately NOT reported as
 *   `error`, because the remedy is identical: go to the wizard and fill in the
 *   named rows. The refusal message names exactly which keys are missing, so the
 *   operator gets the actionable link AND the diagnosis, and neither is lost.
 *
 * 🛑 Neither may be logged as an error, for the reason `already_posted` may not
 * be: a channel that fires on routine outcomes is a channel nobody reads.
 */
export const NON_FAILURE_REFUSALS = ['nothing_to_close', 'setup_incomplete'] as const

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

/**
 * The three inventory balances and the three cumulative activity totals, as one
 * posting asserted them.
 *
 * Every number is integer minor units. `inventoryAdjustments` is SIGNED - a
 * shrinkage is negative - and it is the only one of the six that may be, because
 * the other five are balances and cumulative absorption, which cannot go
 * negative in any state the subledger can reach.
 *
 * 🛑 The activity totals are CUMULATIVE from the opening cutoff through the
 * period end, not the amounts in this one entry. That is what lets a build or an
 * adjustment entered after its accounting month has closed appear in the next
 * open entry carrying its own frozen labour, overhead and 5095 classification,
 * instead of vanishing into the COGS plug.
 */
export interface MonthEndInventorySnapshot {
  balances: {
    inventory_raw_materials: number
    inventory_wip: number
    inventory_finished_goods: number
  }
  activityTotals: {
    absorbedLabor: number
    absorbedOverhead: number
    /** Signed. Negative is shrinkage. */
    inventoryAdjustments: number
  }
}

/**
 * What a posting asserts about the world on either side of itself.
 *
 * ## Why BOTH sides, and why a reversal never re-reads the subledger
 *
 * `after` is what the next month's entry computes its delta from. `before` looks
 * redundant with the previous posting's `after` - and it is, on the happy path.
 * It earns its place twice.
 *
 * 1. **It makes the chain testable.** Row N's `before` must equal row N-1's
 *    `after`. Nothing else in this design can detect a broken prior-row
 *    selection rule, because a wrong prior still produces a *balanced* entry.
 * 2. **It is what a reversal swaps.** See {@link reverseAssertions}.
 *
 * 🛑 The rejected alternative was to reconstruct a reversal's assertions by
 * re-running the month-end reader against the prior-prior period. That is wrong:
 * movements that arrived AFTER the original posted would be included, and the
 * reversal would assert figures unrelated to the lines it is backing out. A
 * reversal must reverse the FROZEN posting, never reinterpret today's subledger
 * - the same rule that stops a standard-cost change from restating a movement.
 *
 * `kind` is a discriminant so a second assertion-carrying posting type is
 * additive rather than a reshape.
 */
export interface PostingAssertions {
  kind: 'month_end_inventory'
  before: MonthEndInventorySnapshot
  after: MonthEndInventorySnapshot
}

/**
 * What an entry WOULD look like, resolved against the org's own chart.
 *
 * A read model: `previewEntry` builds it and writes nothing. It lives here
 * rather than beside `previewEntry` because it crosses the wire to a browser,
 * and everything in this file is client-safe by construction - `post-entry.ts`
 * imports `@auxx/database`, so a UI importing this type from there would drag
 * the server graph into a bundle.
 */
export interface EntryPreview {
  postingType: PostingType
  periodKey: string
  txnDate: string
  docNumber: string
  lines: ResolvedPostingLine[]
  totalMinor: number
  /** Non-empty when the preview would refuse: the same statuses `postEntry` returns. */
  blockedBy?: { status: PostResultStatus; error: string }
  /**
   * What this entry WOULD assert about the world on either side of itself.
   *
   * Present only for a posting type that carries assertions (today, the
   * month-end inventory entry) and only when the preview actually built. The
   * close console renders its roll-forward from this, so an OPEN month shows
   * the same before/after panel a posted one does. Without it the roll-forward
   * could only appear AFTER posting, which is the wrong way round: the point
   * of a preview is to check the movement before committing to it.
   */
  assertions?: PostingAssertions
}

/**
 * One line of a POSTED entry, as the drawer reads it back.
 *
 * Distinct from {@link ResolvedPostingLine} (what a preview projects) because a
 * stored line carries what the chart said AT POSTING TIME - `accountName` is a
 * snapshot, like a movement's frozen cost - plus its stable `lineNumber`.
 * Reading it back through the live chart would silently restate history the
 * moment somebody renames an account, which is the exact thing decision G8
 * stores `accountRole` to prevent.
 */
export interface PostingDetailLine {
  id: string
  lineNumber: number
  accountCode: string
  /** The role the builder emitted. Null on a manual or legacy entry. */
  accountRole: string | null
  /** The account name as it stood when this was posted. A snapshot, never re-read. */
  accountName: string | null
  direction: PostingDirection
  /** Integer minor units, always > 0. `direction` is the only carrier of sign. */
  amountMinor: number
  memo: string | null
  sourceType: string
  sourceId: string
}

/**
 * One posted entry, everything the posting drawer needs, in ONE call.
 *
 * 🛑 `draft` is the STORED envelope, returned verbatim - assertions included.
 * The roll-forward panel renders `assertions.before` / `assertions.after` from
 * here and must never re-derive them by reading the subledger: task 09's whole
 * contract is that a posted entry asserts what the world looked like when it was
 * posted, and a reversal SWAPS the pair rather than recomputing it. Re-reading
 * would make a reversed month render as though it had never been reversed.
 */
export interface PostingDetail {
  id: string
  postingType: PostingType
  periodKey: string
  txnDate: string
  docNumber: string
  status: 'pending' | 'posted' | 'failed' | 'reversed'
  revision: number
  /** The posting this one reverses, when it is a reversal. */
  reversesId: string | null
  currency: string
  totalMinor: number
  lines: PostingDetailLine[]
  /** The stored `PostingDraftV1` envelope, verbatim. Parsed by the caller. */
  draft: unknown
  providerId: string | null
  providerEntryId: string | null
  postedAt: string | null
  postedByUserId: string | null
  failureReason: string | null
  attempts: number
  createdAt: string
}

/**
 * Whether a role's account was chosen by a person or merely proposed.
 *
 * `G19` step 4: a suggested-but-unconfirmed match must read visibly differently
 * from a confirmed one, and a role nothing can ever emit must be markable unused
 * rather than blocking Preview forever.
 *
 * Derived, not stored: `GlRoleAssignment` carries `source`, `confirmedAt` and
 * `markedUnused`, and this collapses those three into the one answer a screen
 * renders. An ABSENT row is `unmapped`; a row with `markedUnused` is `unused`;
 * a row with `confirmedAt` is `confirmed`; anything else is `suggested`.
 */
export type RoleAssignmentState = 'confirmed' | 'suggested' | 'unmapped' | 'unused'

/** One row of the org's editable chart. Mirrors the `gl_account` EntityInstance. */
export interface ChartAccountRow {
  id: string
  code: string
  name: string
  accountType: GlAccountTypeValue
  isActive: boolean
}

/**
 * One role, its mapping, and the account it currently resolves to.
 *
 * Returned for EVERY role in `ACCOUNT_ROLES`, mapped or not - the role map is a
 * complete checklist, not a list of rows that happen to exist, and a screen that
 * only rendered existing rows could never show what is missing.
 */
export interface RoleAssignmentRow {
  role: string
  state: RoleAssignmentState
  /** The `gl_account` id, or null while unmapped or unused. */
  accountId: string | null
  /** Resolved for display. Null when unmapped, or when the account has vanished. */
  account: ChartAccountRow | null
  /** `'seed'` | `'human'` | `'suggested'`, or null with no row. */
  source: string | null
  confirmedAt: string | null
}

/**
 * One account as a connected accounting provider reports it.
 *
 * Provider-neutral by construction, and deliberately NOT QuickBooks' own shape:
 * `AccountingProvider.listProviderAccounts` is what a mapping screen reads, and
 * a screen that spoke `MappedAccount` could only ever map one provider.
 *
 * `number` is the account NUMBER ('1310'), not the id, and is null for a company
 * that does not use account numbers at all - which is the ordinary case in
 * QuickBooks, where numbering is off by default. That is exactly why `G19` maps
 * by CONFIRMATION rather than by matching numbers at post time.
 */
export interface ProviderAccount {
  /** The provider's own id. The only value that ever reaches a journal entry. */
  id: string
  name: string
  /** `'Sales:Product Income'` where the provider nests accounts; else `name`. */
  fullyQualifiedName: string
  number: string | null
  /** The provider's own type string, for display - `'Other Current Asset'`. */
  accountType: string
  /** Normalised to the five statement sections every double-entry system shares. */
  classification: GlAccountTypeValue
  active: boolean
}

/**
 * Whether an account's provider mapping was chosen by a person or merely proposed.
 *
 * The same three-way distinction {@link RoleAssignmentState} draws one level up,
 * and for the same `G19` reason: a match the suggester made must read visibly
 * differently from one a human agreed to, because only the second is allowed to
 * put money into a provider account.
 *
 * 🛑 There is no `unused` member, and that asymmetry with `RoleAssignmentState`
 * is deliberate. A ROLE may legitimately be one an org never emits. An ACCOUNT
 * in the org's own chart that no provider account corresponds to is not
 * "excused" - it is either not mapped yet or not needed by any role, and the
 * role map is where the second is already recorded. A second way to say it would
 * let the two disagree.
 */
export type AccountIdentityState = 'confirmed' | 'suggested' | 'unmapped'

/**
 * Why the suggester proposed a provider account, in the words a screen shows.
 *
 * `G19` requires the UI to "clearly separate suggestions from confirmed
 * mappings", which means saying WHY - "matched on account number 1310" earns a
 * different amount of trust than "matched on the name Inventory Asset", and the
 * person confirming is the only one who can tell which is right.
 */
export type AccountSuggestionReason = 'number' | 'name'

/**
 * One of the org's own accounts, its provider mapping, and the state of that
 * mapping.
 *
 * Returned for EVERY live account in the chart, mapped or not - the same
 * checklist rule {@link RoleAssignmentRow} follows, for the same reason: a list
 * of only the rows that happen to exist could never show what is missing, and
 * "which accounts still need mapping" is the question this screen exists to
 * answer.
 */
export interface AccountIdentityRow {
  /** The `gl_account` instance, always present - this row IS an account. */
  account: ChartAccountRow
  state: AccountIdentityState
  /** The provider account this maps to. Null while `unmapped`. */
  providerAccountId: string | null
  /** As recorded when the mapping was made - see the schema on why it is display-only. */
  providerAccountName: string | null
  providerAccountNumber: string | null
  /** `'suggested'` | `'human'`, or null with no row. */
  source: string | null
  confirmedAt: string | null
  /**
   * The live provider account the mapping currently names, re-read from the
   * provider's chart.
   *
   * 🛑 Null with a non-null `providerAccountId` is the DANGLING case - the
   * provider account was deleted, deactivated or merged out from under a
   * confirmed mapping. `G19` requires every close to revalidate exactly this, so
   * a screen must render it as a repair rather than as a mapping.
   */
  liveProviderAccount: ProviderAccount | null
  /**
   * What the matcher would propose for an unmapped account, and why. Null once
   * something is mapped, and null when nothing plausible matched.
   */
  suggestion: { account: ProviderAccount; reason: AccountSuggestionReason } | null
}

/**
 * One month in the close console's period strip.
 *
 * Derived, never stored. `state` is computed from three things that already
 * exist - the `GlPosting` rows, `accounting.cutoffPeriod` and
 * `ledger.lockedThroughMonth` - which is why task 13 deferred the
 * `gl_close_period` table: there is nothing for it to hold that is not already
 * answerable.
 *
 * 🛑 `locked` and `posted` are not the same and must not be collapsed. A locked
 * month may never have been posted (an org can lock a range it does not intend
 * to close), and a posted month is not locked until somebody says so. They call
 * for different actions, and the toolbar renders them differently.
 */
export interface ClosePeriod {
  /** `'2026-08'`. */
  periodKey: string
  state: 'open' | 'posted' | 'locked'
  /** The effective posting for the month, when there is one. */
  glPostingId: string | null
  docNumber: string | null
  totalMinor: number | null
  postedAt: string | null
  /** `0` for an original; a reversal chain climbs from there. */
  revision: number
}

/** One claimed-but-not-posted entry, as the close console's banner reads it. */
export interface UnpostedPeriod {
  periodKey: string
  postingType: PostingType
  glPostingId: string
  /**
   * Kept distinct rather than collapsed into "unposted": `pending` is claimed
   * and in flight (or claimed by a run that died mid-push, which the idempotency
   * ladder heals), `failed` was attempted and refused and carries the reason.
   * They call for different actions.
   */
  status: 'pending' | 'failed'
  docNumber: string
  attempts: number
  failureReason: string | null
}

/** One entry whose lines do not tie, or do not sum to its recorded total. */
export interface BooksBalanceDiscrepancy {
  glPostingId: string
  docNumber: string
  postingType: PostingType
  periodKey: string
  totalDebitMinor: number
  totalCreditMinor: number
  /** `GlPosting.totalMinor`, which must equal BOTH sides. */
  recordedTotalMinor: number
}

/**
 * The after-the-fact balance sweep.
 *
 * `postingsChecked` rides along on purpose - "0 discrepancies out of 0" and
 * "0 out of 412" are very different answers and a banner has to tell them apart.
 */
export interface BooksBalanceReport {
  balanced: boolean
  postingsChecked: number
  discrepancies: BooksBalanceDiscrepancy[]
}

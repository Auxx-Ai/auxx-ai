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
import type { GlAccountSubtypeValue } from './account-subtype'
import type { AccountRole } from './build-entry'
import type { DefaultChartAccount, GlAccountTypeValue } from './default-chart'

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
  // An invoice ISSUED: `Dr accounts_receivable / Cr revenue_service /
  // Cr sales_tax_payable`, dated the invoice's own `issuedAt`. The receivable
  // every payment entry relieves and nothing used to raise
  // (plans/accounting/tasks/08-invoice-revenue.md).
  //
  // 🛑 Prefix `INI`, never `INV` - `month_end_inventory` holds `INV` and
  // documents already carry it.
  'invoice_issued',
  // A held customer deposit reclassed onto an invoice:
  // `Dr customer_deposits / Cr accounts_receivable`. Neither a payment (no
  // money moved) nor a manual journal (nobody keyed it)
  // (plans/accounting/tasks/07-customer-deposits.md).
  'deposit_application',
  // A credit memo ISSUED: `Dr revenue_returns_allowances / Dr sales_tax_payable
  // / Cr accounts_receivable`, dated the memo's own `issuedAt`, plus
  // `Dr accounts_receivable / Cr clearing_card` when a channel refund already
  // paid the money back. Keys on the memo's own number, like `invoice_issued`,
  // and is reversed by void (plans/accounting/tasks/10-credit-memos.md).
  'credit_memo',
  // 🛑 The one posting type auxx does not author. An entry the ACCOUNTANT wrote
  // in the connected provider, read back off their general ledger and written as
  // one of our rows (plans/accounting/tasks/20-two-authors-one-ledger.md §6).
  //
  // `periodKey` is the provider's own transaction id - the claim index gives
  // per-transaction idempotency for free, exactly as `payout` keys on a payout
  // id - and `exportStatus` stays `not_required` because we never pushed it.
  // `EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync` is `'none'`, and that
  // declaration is the loop guard: pushing their own entries back at them would
  // double every one of them, and both copies would balance.
  'provider_sync',
  // brief 21 §1.4. The generated occurrence of a recurring template:
  // depreciation, an accrual, a prepaid amortization. Its OWN type rather than
  // `manual_journal` because the claim index is the only exact idempotency
  // layer available - `FieldValue` has no unique index that could carry
  // `(ruleId, occurrenceDate)`, so the record layer races and this does not.
  'recurring_journal',
  // brief 21 §3.2. `Dr <expense> / Cr A/P` for rent, insurance, a legal
  // invoice. Distinct from `vendor_bill`, which is the L3 purchasing story
  // (`Dr GRNI / PPV`) and cannot express an expense-coded line.
  'expense_bill',
] as const

export type PostingType = (typeof POSTING_TYPES)[number]

/** Which side of the entry a line sits on. The ONLY carrier of sign. */
export type PostingDirection = 'debit' | 'credit'

/**
 * Who a receivable or payable line is attributable to
 * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §1).
 * `'customer'` carries a `contact` instance id, `'vendor'` a `company`
 * instance id. Named `counterparty`, not `entity`: `entity` already means
 * three things in this codebase and QuickBooks' own line field is a fourth.
 */
export type CounterpartyType = 'customer' | 'vendor'

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
  /**
   * Who this line is attributable to, when the account requires it
   * (brief 13 §1.1). OURS, never a provider id (P2): the adapter resolves it
   * to the provider's Customer or Vendor through the identity field, the same
   * hop `resolveMappedAccounts` makes for an account. Set ONLY on the
   * receivable or payable line, and FROZEN onto `GlPostingLine` at post time
   * so a retry exports under the attribution the ledger asserted, never one
   * re-resolved after a merge or a rename. Absent on every other line, which
   * is most of them.
   */
  counterpartyType?: CounterpartyType
  counterpartyId?: string
  /**
   * Reporting dimensions on the line, `{ channel: 'dealer' }` or
   * `{ jurisdiction: 'CO' }`, written to `GlPostingLine.dimensions` (brief 13
   * §5). A dimension is an attribute of a line, never a reason to split an
   * account: revenue by channel is one account with this key on each line.
   * Ours, and reportable from our own statements; the QuickBooks class hop is
   * a separate piece of work and is not done here. Absent on most lines.
   */
  dimensions?: Record<string, string>
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
      glAccountId?: never
    })
  | (GlPostingLineBase & {
      /**
       * An account CODE out of this org's own chart, e.g. `'6300'`. Only a
       * human-authored entry (`manual_journal`, `opening_balance`) may use it.
       */
      accountCode: string
      accountRole?: never
      glAccountId?: never
    })
  | (GlPostingLineBase & {
      /**
       * A `gl_account` instance ID out of this org's own chart. The IDENTITY
       * (task 15): a line that must land on exactly the account another line
       * landed on, whatever the chart has since been renamed or renumbered to.
       * A reversal uses it, so the original is backed out of the account it
       * went into rather than out of whatever its role resolves to today.
       */
      glAccountId: string
      /**
       * The role SNAPSHOT to stamp on the stored line, carried verbatim from
       * the line being reversed. Never resolved: the id decides the account,
       * this only records which account the line was SUPPOSED to be, so a
       * reversal reads the same way in the journal as the entry it backs out.
       */
      accountRole?: string
      accountCode?: never
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
  /**
   * The FROZEN list of what this entry summarises, when its lines do not name
   * them one by one. Optional, and absent on every entry built before this
   * existed.
   *
   * 🛑 **This is the audit trail a summarised entry would otherwise not have.**
   * A batch fulfillment posting carries one credit line per account for a whole
   * day of shipments (49 §2.5), so `sourceId` names the period key and not the
   * fifty orders behind it. Without the list there is no way to answer "which
   * orders are in this number" three years later, and no way to compute the
   * compensating entry a later correction needs.
   *
   * Rides into `GlPosting.draft` verbatim, because `buildPostingDraft` carries
   * the whole `BuiltEntry` (see `draft.ts`). Typed `unknown` on purpose: the
   * shape belongs to whichever builder wrote it - `buildFulfillmentBatchEntry`
   * writes `FulfillmentBatchSource[]` - and `postings/types.ts` must not gain a
   * dependency on `money/` to say so.
   */
  sources?: unknown
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
  /**
   * The `gl_account` `EntityInstance` id this line resolved to. The IDENTITY
   * (plans/accounting/tasks/15-the-account-id-is-the-identity.md §2). No
   * foreign key anywhere it lands - a ledger line outlives the chart row.
   */
  glAccountId: string
  /**
   * Account CODE, e.g. `'1310'`, from the org's own chart. Never a provider id.
   * A SNAPSHOT beside `glAccountId` - the code is a label the owner may rename
   * or renumber, and `glAccountId` above is what a report should group by.
   * Null when the account carries no code (task 15 §5): a snapshot of nothing
   * is null, exactly as `accountName` already is.
   */
  accountCode: string | null
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
 * - `not_exported` - this POSTING TYPE is never pushed, whatever the org has
 *   connected. `EXPORT_ROUTE_BY_POSTING_TYPE` routes `opening_balance` and
 *   `provider_sync` to `'none'`, both because an entry that came FROM the
 *   provider must never be handed back at it.
 *
 *   🛑 It exists for the same reason `disabled` does, and it was found the same
 *   way `disabled` would have been. Before it, a `'none'`-routed entry borrowed
 *   `not_connected` and the close console told an org with QuickBooks connected
 *   that **no accounting system is connected** - observed on DemoOrg1's first
 *   wizard drive, two pages after the wizard itself displayed the company name.
 *   The remedy for `not_connected` is "connect one"; the remedy for this is
 *   nothing at all, because it is working. A reader cannot guess which they are
 *   looking at if the two share a value (brief 22 §5).
 */
export type PostEntryStatus =
  | 'posted'
  | 'already_posted'
  | 'healed'
  | 'not_connected'
  | 'disabled'
  | 'not_exported'

/**
 * What the export of one entry to the accounting provider did.
 *
 * Mirrors the `GlPostingExportStatus` pgEnum. Kept in step with it by
 * `__tests__/types.test.ts`, the same way `POSTING_TYPES` is.
 *
 * 🛑 This is the ONLY place a provider's answer is recorded. `GlPosting.status`
 * is what the LEDGER did and a provider may never move it - see
 * `plans/accounting/export-state-split.md`.
 */
/**
 * What the LEDGER did with an entry.
 *
 * Mirrors the `GlPostingStatus` pgEnum, and pinned to it by
 * `__tests__/types.test.ts` the same way {@link POSTING_TYPES} is.
 *
 * 🛑 Two values. `pending` and `failed` were retired by the export split: they
 * were never ledger states, they described a push, and a provider refusal that
 * moved this field took a real entry out of every report. Four hand-written
 * copies of the old union survived that change because they were string
 * literals rather than this type - which is why this exists rather than each
 * interface spelling the union out. See plans/accounting/export-state-split.md.
 */
export const POSTING_STATUSES = ['posted', 'reversed'] as const

export type PostingStatus = (typeof POSTING_STATUSES)[number]

export const POSTING_EXPORT_STATUSES = ['not_required', 'pending', 'exported', 'failed'] as const

export type PostingExportStatus = (typeof POSTING_EXPORT_STATUSES)[number]

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
  /**
   * WHICH instance of that provider answered - a QuickBooks realm, a Xero
   * tenant. Stamped onto `GlPosting.providerTenantId`; the core never parses it.
   *
   * 🛑 OPTIONAL, and it has to be: `NoneAccountingProvider` has no tenant and
   * must not be forced to invent one. An `externalId` without one of these is a
   * pointer with no address space - entry `147` exists in every QuickBooks
   * company - so an adapter that HAS a tenant must always return it (task 24 §2).
   */
  tenantId?: string
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
  // The org has never enabled the accounting module (`FeatureKey.accounting`
  // is off). A first-class silent case like `not_connected`, never a warning:
  // nothing is built, nothing is claimed, nothing is logged (task 17 section 3).
  // Distinct from `setup_incomplete`, which means the module is on and the
  // wizard was not finished, and from `disabled`, which is a provider switch.
  | 'not_enabled'
  // Wave 1 (HANDOFF slot 1A). A manual or opening entry named one of the three
  // inventory accounts by code; the remedy is the close console, which is the
  // only writer of those balances.
  | 'inventory_role_refused'
  // A code-based line names an account the org's chart does not hold, or holds
  // archived or inactive. The message names the row.
  | 'account_invalid'
  // 🛑 The month still holds revenue that has not reached the ledger: a shipped
  // fulfillment with no live posting stamped, or a `channel` credit memo still
  // in draft (49 §2.4, §8.4 decision 7; 10 §3.4). NOT `error` - nothing is
  // broken and nothing failed to build - and not one of the
  // `NON_FAILURE_REFUSALS` either, because unlike an empty month it is a piece
  // of work somebody has to do before the month is honest. It has its own status
  // so the console can point at the two places that work is done rather than
  // rendering "the entry could not be built" over a set of books that is simply
  // short.
  | 'revenue_incomplete'
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
 * persist the outcome without its own try/catch.
 *
 * `glPostingId` is set whenever the claim succeeded or found an existing row -
 * so it is present on `already_posted`, and absent on the pre-claim refusals
 * (`period_closed`, `account_unmapped`, `unbalanced`), which is exactly the
 * distinction a caller needs to know whether anything was written.
 */
export interface PostResult {
  status: PostResultStatus
  /**
   * What the EXPORT did, when one was attempted. Absent on a pre-claim refusal,
   * where nothing was ever written to export.
   *
   * 🛑 A caller deciding whether the LEDGER took the entry reads `status` (or
   * simply `glPostingId`), never this. An export that failed leaves
   * `status: 'posted'` and `exportStatus: 'failed'`, and a caller that rolls
   * back on the latter reintroduces the exact defect
   * `plans/accounting/export-state-split.md` closed.
   */
  exportStatus?: PostingExportStatus
  /** The `GlPosting` row, once claimed. Absent on a pre-claim refusal. */
  glPostingId?: string
  /** Always set once the entry is built - it is minted before the claim. */
  docNumber?: string
  /** `'quickbooks'`, `'none'`, or absent when no provider was reached. */
  providerId?: string
  /** The provider's own id for the entry, once pushed. */
  providerEntryId?: string
  /**
   * WHICH instance of the provider `providerEntryId` belongs to. Absent when
   * nothing was pushed.
   *
   * 🛑 Carried out to the UI rather than kept on the row alone, because the
   * one thing a reader does with `providerEntryId` is follow it, and a deep
   * link resolved against the wrong company reports a live entry as deleted
   * (task 24 §4). The callout compares this against the connected tenant and
   * renders no link at all when they differ.
   */
  providerTenantId?: string
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
  /** The `gl_account` instance id this line posted to. The identity (task 15). */
  glAccountId: string
  /** The account code as it stood when this was posted. A snapshot, never re-read. Null when the account had none. */
  accountCode: string | null
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
  /** The counterparty frozen on the line at post time (brief 13 §1.1). Null on most lines. */
  counterpartyType: CounterpartyType | null
  counterpartyId: string | null
  /** The line's reporting dimensions as stored, `{ channel: 'dealer' }`. Null on most lines. */
  dimensions: Record<string, string> | null
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
  status: PostingStatus
  /** What the EXPORT did. Read this, never `status`, to learn about the provider. */
  exportStatus: PostingExportStatus
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
  /**
   * Which instance of the provider the entry went to. NULL means no export ever
   * reached one - see `GlPosting.providerTenantId`, which this reads back
   * verbatim and never reconstructs.
   */
  providerTenantId: string | null
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

/**
 * One row of the org's editable chart. Mirrors the `gl_account` EntityInstance.
 *
 * `code` is OPTIONAL (task 15 §5). A chart imported from QuickBooks ships with
 * account numbers off, and a person may keep a chart by name alone. The id is
 * the identity everywhere; the code is a label, and a null one is rendered as
 * the name alone (`accountLabel`).
 */
export interface ChartAccountRow {
  id: string
  code: string | null
  name: string
  accountType: GlAccountTypeValue
  /**
   * The second fact about an account beyond its statement classification
   * (`plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §3), pulled
   * forward for `cost_of_goods_sold`: the P&L groups COGS by this, never by a
   * code prefix, because a chart without codes has no prefix to test.
   */
  subtype: GlAccountSubtypeValue | null
  isActive: boolean
  /**
   * The account has been removed from the chart (archived - `removeChartAccount`
   * never deletes). **Absent means not archived**, the same reading `isActive`
   * gives an absent value, and the same reason: nearly every row is neither.
   *
   * 🛑 Only ever set when the caller ASKED for archived rows. Every reader but
   * the settings list excludes them IN THE QUERY, which is what makes archiving
   * removal as far as the resolver, the role picker and the close are concerned
   * (`removeChartAccount`'s reason 1). This field exists so the one screen that
   * may show them can say which is which - never so a reader can start filtering
   * archived rows out in memory.
   */
  isArchived?: boolean
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
  /**
   * `'seed'` | `'human'` | `'suggested'` | `'import'`, or null with no row.
   *
   * `'import'` is written by `importChartFromProvider` for a role it matched
   * unambiguously on the provider's chart (brief 16 §2.2). It renders as
   * `suggested` like `'seed'` does, because `state` is derived from
   * `confirmedAt` alone: the import chose it, nobody has agreed yet.
   */
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
 * One row of a connected provider's balance sheet, at the granularity the
 * opening-balance suggestion (plans/accounting/tasks/19) can act on.
 *
 * Provider-neutral by construction, like {@link ProviderAccount} - the shape a
 * future second provider's own report tool would emit too, not QuickBooks'
 * report JSON verbatim. Produced by the apps-repo report tool
 * (`get_quickbooks_balance_sheet`), which has already walked the report's
 * section/summary tree, dropped every `Summary` and `Section` row, parsed
 * money into integer minor units and normalised sign to debit-positive -
 * brief 19 section 3.3 is the full contract.
 */
export interface ProviderBalanceRow {
  /** QuickBooks Account.Id. Null only for a computed row (see below). */
  providerAccountId: string | null
  /** As rendered, for the unmatched list. Not used to join. */
  name: string
  /** 'account' | 'net_income'. Nothing else is emitted. */
  kind: 'account' | 'net_income'
  /** Integer minor units, DEBIT-POSITIVE. See below. */
  minorSigned: number
}

/**
 * A connected provider's balance sheet as of one date - the source for the
 * opening-balance suggestion (plans/accounting/tasks/19 section 3.3) and for
 * the agreement view (plans/accounting/tasks/20 section 8), and what
 * `AccountingProvider.readProviderBalances` returns unchanged from the tool.
 */
export interface ProviderBalanceSheet {
  /** `Header.EndPeriod`, asserted equal to the `asOf` that was asked for. */
  asOf: string
  /** `Header.Currency`, the company's home currency. Section 5.5 compares it. */
  currency: string
  /** `Header.ReportBasis`. Always `'Accrual'` from this tool; carried so a reader can check. */
  reportBasis: string
  /** `Header.Option[NoReportData] === 'false'`. False is the empty-import refusal of section 4.5. */
  hasData: boolean
  /** Non-zero rows only, in report order. */
  rows: ProviderBalanceRow[]
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
 * What an import of the provider's chart would do, before it does it
 * (brief 16 §2.2). Produced by the pure `planChartImport`, executed by
 * `importChartFromProvider`.
 *
 * `create` carries the code (the provider's `number`, or null), the name, the
 * five-way type and the subtype the declared inverse table stamps, or null
 * where the provider type is ambiguous (`Other Current Asset` is deliberately
 * unmapped: Undeposited Funds, prepaids and Inventory Asset all arrive under
 * it). `alreadyImported` is every provider account some `gl_account` already
 * carries as its identity, renamed or not.
 */
export interface ChartImportPlan {
  create: Array<{
    providerAccount: ProviderAccount
    code: string | null
    name: string
    accountType: GlAccountTypeValue
    subtype: GlAccountSubtypeValue | null
  }>
  skippedInactive: ProviderAccount[]
  alreadyImported: Array<{ providerAccount: ProviderAccount; glAccountId: string }>
  /** Roles with exactly one unambiguous candidate, resolved AFTER creation. */
  roleCandidates: Array<{ role: AccountRole; match: 'subtype' | 'name'; providerAccountId: string }>
  /** Core role-bearing accounts the provider chart cannot satisfy. */
  missingCore: DefaultChartAccount[]
}

/**
 * What `importChartFromProvider` did (brief 16 §2.2). Counts, never rows: the
 * screen reports "12 added, 41 already here" and re-reads the chart itself.
 */
export interface ChartImportResult {
  created: number
  alreadyImported: number
  skippedInactive: number
  /** Written with `source: 'import'`, only for roles that were `unmapped`. */
  rolesAssigned: AccountRole[]
  /** The uncoded, unmapped core accounts added because the provider lacks them. */
  coreCreated: DefaultChartAccount[]
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

/**
 * One entry that IS in the books and is not in the accounting system.
 *
 * 🛑 Renamed from `UnpostedPeriod` by the export split, because the old name
 * described a state that no longer exists: a claimed row is posted, so nothing
 * is ever "claimed but not posted". What can still be outstanding is the COPY.
 *
 * `pending` is owed and has not been refused - in flight, or claimed by a run
 * that died before the push. `failed` was attempted and refused, and carries
 * the reason. They call for different actions, so they are not collapsed.
 */
export interface FailedExport {
  periodKey: string
  postingType: PostingType
  glPostingId: string
  exportStatus: 'pending' | 'failed'
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
  /**
   * The COMPLETENESS half, for one month (49 §2.4).
   *
   * 🛑 Balance is not completeness. Every entry in the books can tie perfectly
   * while a month is missing a week of revenue, and that is exactly the state a
   * connector-fed org lands in: the shipments are logged and nothing has posted
   * them. The sweep above proves the entries that exist are right; this proves
   * there are no entries still owed. A screen that showed only the first would
   * report green books that are short.
   *
   * `null` means NOT COUNTED, never zero. The counts are per MONTH and the sweep
   * is org-wide, so a caller that asked no month gets no answer rather than a
   * `0` that reads as "nothing outstanding" - the same rule the opening balances
   * follow, and for the same reason.
   */
  month: string | null
  /** Shipments in `month` with no live posting stamped. `null` when no month was asked. */
  unpostedShipments: number | null
  /** `channel` credit memos in `month` still in draft. `null` when no month was asked. */
  unissuedChannelCreditMemos: number | null
  /**
   * Issued credit memos in `month` with no live posting stamped (25 §9.1).
   * `null` when no month was asked.
   *
   * 🛑 Not the same question as `unissuedChannelCreditMemos`, and neither
   * subsumes the other. That count is a memo nobody has decided about yet; this
   * is a memo somebody HAS issued whose contra-revenue is still outside the
   * books, which only became possible once memos started batching - before that,
   * issuing posted immediately. The remedies differ too, so both are reported.
   */
  unpostedCreditMemos: number | null
}

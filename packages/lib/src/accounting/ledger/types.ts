// packages/lib/src/accounting/ledger/types.ts
//
// The shapes of a double-entry posting, ours.
//
// Decision P1 (plans/purchasing/README.md): auxx.ai is the system of record for
// purchase -> receipt -> bill -> posting, and the accounting system is an
// EXPORTER. Everything in this file therefore describes an entry that is
// complete and meaningful with NO provider connected at all. Nothing here names
// QuickBooks, and nothing here carries a provider's identifier.

import type { AccountRole } from './builders/entry'
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
import type { GlAccountSubtypeValue } from './chart/account-subtype'
import type { DefaultChartAccount, GlAccountTypeValue } from './chart/default-chart'
import type { CloseBlockerItem } from './periods/close-blockers'

export const POSTING_TYPES = [
  'fulfillment',
  'payout',
  'month_end_deferral',
  'month_end_reversal',
  // MIGRATION step 5. ONE entry per inventory DOCUMENT - a fulfillment, a goods
  // receipt, an adjustment, a build, a return, an opening run - at the frozen
  // `stock_movement_extended_cost` of the movements it links as members. The
  // document kind travels in the built envelope, not in a second posting type,
  // because every kind claims, exports and reverses identically (TARGET §5).
  'inventory_movement',
  // THE vendor bill, of either kind (73 D3): `Dr GRNI ± PPV` per line matched to
  // a purchase order line, `Dr <the account it was coded to>` per line that is
  // not, the header's shipping and tax, `Cr A/P` at the bill total. The other
  // half of the GRNI an `inventory_movement` credits on a receipt - without it
  // that accrual never clears. `expense_bill` was a second type for the second
  // kind and was retired: one record cannot have two entries.
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
  // A customer receipt or a vendor payment, posted off `MoneyTransaction`:
  // `Dr <the cash endpoint> / Cr accounts_receivable`, or the same with both
  // sides flipped for money going out (task 71 §0).
  'payment',
  // TARGET §5: a customer refund - `Dr returns / Cr clearing or bank`. Its own
  // type rather than a sides-swapped `payment` so the export can send a Refund
  // Receipt and a ledger card can name what it is.
  'refund',
  // An invoice ISSUED: `Dr accounts_receivable / Cr revenue_service /
  // Cr sales_tax_payable`, dated the invoice's own `issuedAt`. The receivable
  // every payment entry relieves and nothing used to raise
  // (plans/accounting/tasks/done/08-invoice-revenue.md).
  //
  // 🛑 Prefix `INI`, never `INV` - `inventory_movement` holds `INV`.
  'invoice_issued',
  // A held customer deposit reclassed onto an invoice:
  // `Dr customer_deposits / Cr accounts_receivable`. Neither a payment (no
  // money moved) nor a manual journal (nobody keyed it)
  // (plans/accounting/tasks/done/07-customer-deposits.md).
  'deposit_application',
  // A credit memo ISSUED: `Dr revenue_returns_allowances / Dr sales_tax_payable
  // / Cr accounts_receivable`, dated the memo's own `issuedAt`, plus
  // `Dr accounts_receivable / Cr clearing` when a channel refund already
  // paid the money back. Keys on the memo's own number, like `invoice_issued`,
  // and is reversed by void (plans/accounting/tasks/done/10-credit-memos.md).
  'credit_memo',
  // 🛑 The one posting type auxx does not author. An entry the ACCOUNTANT wrote
  // in the connected provider, read back off their general ledger and written as
  // one of our rows (plans/accounting/tasks/20-two-authors-one-ledger.md §6).
  //
  // `periodKey` is the provider's own transaction id - the claim index gives
  // per-transaction idempotency for free, exactly as `payout` keys on a payout
  // id. Its avenue is null, so nothing ever pushes it back at them.
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
  // A vendor credit ISSUED: `Dr accounts_payable / Cr <each line's account>`,
  // dated the credit's own `issuedAt`. The expense bill's entry with the sides
  // flipped, and its own type so the export can send a Vendor Credit and a
  // ledger card can name what it is (task 71 §5 U7, D10).
  'vendor_credit',
] as const

export type PostingType = (typeof POSTING_TYPES)[number]

/** Which side of the entry a line sits on. The ONLY carrier of sign. */
export type PostingDirection = 'debit' | 'credit'

/**
 * Who a receivable or payable line is attributable to
 * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §1).
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
  /**
   * Which SOURCE this line's ROLE resolves through (task 47 §5). Ignored on a
   * code line and on an id line, which name their account outright.
   *
   * 🛑 **On the LINE, not only on the entry, because one entry can span two
   * stores.** The fulfillment group merges a day's shipments into one journal;
   * two shipments from two storefronts credit two different revenue accounts and
   * have to stay two lines. `run.ts`'s merge key already includes everything
   * that splits a line, and this joins it.
   *
   * ⚠️ An entry-level scope (`prepareEntry`/`postEntry`'s `scope`) is the
   * convenient door for an entry that is wholly from one source - a payout, a
   * credit memo. Precedence is `line.sourceScope ?? options.scope`, resolved in
   * exactly one place, `resolveAccountLines`.
   */
  sourceScope?: RoleSourceScope
}

/**
 * WHICH SOURCE a posted event came from, for the roles that read one
 * (task 47 §5, rail axis added by task 58 §5.1).
 *
 * Consulted only for the roles in `SCOPABLE_ROLES` - the three revenue roles,
 * `clearing`, `payment_processing_fees` and `bank`. Every other role ignores it
 * entirely, which is what keeps an org that maps nothing byte-for-byte
 * identical to how it behaved before task 47, and that no-op is the acceptance
 * test for the whole brief.
 *
 * 🛑 **`undefined` and `null` mean different things, and the difference is the
 * manual bucket.**
 *
 * | value | meaning |
 * | --- | --- |
 * | the key is absent | this caller does not know the axis. Use the ORG DEFAULT |
 * | `null` on `store` | this record had NO connected source. Use the MANUAL bucket |
 * | an id | that `FinancialSourceAccount` (`store`) or `payment_gateway` (`rail`) |
 *
 * `rail` has no manual counterpart: a manual order has no rail, so a `null`
 * there reads the same as an absent key (§4).
 *
 * Declared HERE rather than in `resolve-roles.ts` because a LINE carries one
 * ({@link GlPostingLineBase.sourceScope}) and this file is client-safe, while
 * the resolver reaches a database. `resolve-roles.ts` re-exports it.
 */
export interface RoleSourceScope {
  /** `effect.sourceStoreId`. Null means the manual bucket; see the table above. */
  store?: string | null
  /** `effect.paymentGatewayId`. Null means no rail; see the table above. */
  rail?: string | null
  /** Settlement currency. Only consulted for a rail role, alongside `rail`. */
  currency?: string
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
  /** Calendar, document or membership identity; `txnDate` is the actual book date. */
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
  /**
   * Why a line landed on the account it did, in words, for every line whose
   * account was chosen by a FORK rather than a plain role (brief 28 §5). Lines a
   * role resolved carry none; an entry with no forks carries no list at all.
   *
   * Captured by the builder at build time and frozen into `GlPosting.draft`
   * beside `sources`, never reconstructed at read time: the fork's inputs (a
   * gateway record, a bank account's confirmed identity) move later, and a
   * reason derived from today's records is not the reason the entry was posted
   * with.
   */
  reasons?: PostingReason[]
}

/**
 * One sentence explaining one line's account (brief 28 §5).
 *
 * `line` is the 1-based line number the stored `GlPostingLine` carries, which
 * is the line's position once the entry's lines are ordered by `sortOrder`.
 * Every builder that emits reasons computes it from its own line order, and the
 * drawer joins on `PostingDetailLine.lineNumber` to prefix the account.
 */
export interface PostingReason {
  line: number
  sentence: string
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
   * (plans/accounting/tasks/done/15-the-account-id-is-the-identity.md §2). No
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
export const POSTING_STATUSES = ['draft', 'posted', 'reversed'] as const

export type PostingStatus = (typeof POSTING_STATUSES)[number]

/**
 * How a source relates to the posting on `GlPostingSource`.
 *
 * `subject` is what the entry is OF, and its row IS the claim - one live
 * subject per `(sourceKind, sourceId, occurrence)`. `parent` lets an order list
 * its fulfillment, receipt and refund postings in one query; `member` names what
 * a posting summed. See plans/accounting/TARGET.md §1.
 */
export const POSTING_LINK_ROLES = ['subject', 'parent', 'counterparty', 'member'] as const

export type PostingLinkRole = (typeof POSTING_LINK_ROLES)[number]

/** One `GlPostingSource` row as a writer supplies it. `occurrence` defaults to `'original'`. */
export interface GlPostingSourceInput {
  sourceKind: string
  sourceId: string
  linkRole: PostingLinkRole
  /**
   * Which pass over the same source this is. `'original'` for the first entry,
   * `'reversal'` for a reversal's own subject row, or a write-off / application
   * id for the repeatable actions - it is the fourth column of the claim, so a
   * second write-off against one invoice is representable and a second issuance
   * is not.
   */
  occurrence?: string
}

/**
 * Result of removing one object we created, from the provider that holds it.
 *
 * `already_gone` is a SUCCESS and is reported rather than hidden: a withdrawal
 * whose outcome was unknown is resolved by repeating it, and the repeat has to
 * be able to say "there was nothing left to remove" without that reading as a
 * fresh delete in the audit trail.
 */
export interface WithdrawResult {
  status: 'withdrawn' | 'already_gone'
  /** The provider's own id for the object, echoed back. */
  externalId: string
  /** Which provider answered - `'quickbooks'`. */
  providerId: string
  /** The provider's own answer, kept verbatim for the delivery operation's outcome. */
  raw?: Record<string, unknown>
}

/** One entry's answer from a bulk reversal. */
export interface ReverseOutcome {
  glPostingId: string
  docNumber: string | null
  /** `reversed` wrote a reversing entry; anything else wrote nothing at all. */
  status: 'reversed' | 'refused'
  /** The refusal, verbatim from the `PostResult`. `undefined` on `reversed`. */
  message?: string
}

/** The tally the queue renders, plus the per-posting detail behind it. */
export interface ReverseManyResult {
  reversed: number
  refused: number
  outcomes: ReverseOutcome[]
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
 * Every way `postEntry` can end. Every one is a return value rather than a
 * throw - see {@link PostResult}.
 *
 * `already_posted` is a SUCCESS and must never be logged as an error. Logging a
 * routine converged re-run as a failure trains everyone to ignore the channel,
 * and the channel is the only warning a real double-post would arrive on.
 */
export type PostResultStatus =
  | 'posted'
  | 'already_posted'
  | 'drafted'
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
  // `postEntry` with `mode: 'draft'`: a `GlPosting` row exists with its lines
  // and no doc number, holding no claim. A SUCCESS - `postDraft` promotes it -
  // but not one the books read, so `didLedgerAccept` is false for it.
  | 'drafted'
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
  /** The `GlPosting` row, once claimed. Absent on a pre-claim refusal. */
  glPostingId?: string
  /** Always set once the entry is built - it is minted before the claim. */
  docNumber?: string
  /** Human-readable. On `account_unmapped` it names EVERY offending role. */
  error?: string
  /**
   * The same pieces of work {@link EntryPreview.blockedBy} carries, on the POST
   * path. Present for the refusals that are made of several independent things,
   * so the result callout can offer a remedy per thing rather than one button
   * for all of them.
   */
  items?: CloseBlockerItem[]
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
  blockedBy?: {
    status: PostResultStatus
    error: string
    /**
     * The refusal broken into the individual pieces of work it is made of, for
     * the refusals that HAVE pieces (`revenue_incomplete`'s three counts,
     * `account_unmapped`'s roles). Absent on a refusal that is one indivisible
     * thing, and the console renders those from `error` as it always has.
     *
     * 🛑 `error` is assembled FROM these by `closeBlockerMessage`. They are two
     * renderings of one answer, never two answers.
     */
    items?: CloseBlockerItem[]
  }
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
  /** Null while `status` is `draft` — assigned when it posts. */
  docNumber: string | null
  status: PostingStatus
  revision: number
  /** The posting this one reverses, when it is a reversal. */
  reversesId: string | null
  currency: string
  totalMinor: number
  lines: PostingDetailLine[]
  /** The stored `PostingDraftV1` envelope, verbatim. Parsed by the caller. */
  draft: unknown
  postedAt: string | null
  postedByUserId: string | null
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

// Re-exported through this file's own graph rather than imported by every
// consumer: `RoleAssignmentRow.axis` is the only reason a screen needs it.
import type { ScopeAxis } from './builders/entry'

export type { ScopeAxis } from './builders/entry'

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
   * (`plans/accounting/tasks/done/13-cash-accounts-and-the-qbo-seam.md` §3), pulled
   * forward for `cost_of_goods_sold`: the P&L groups COGS by this, never by a
   * code prefix, because a chart without codes has no prefix to test.
   */
  subtype: GlAccountSubtypeValue | null
  /** The parent account's id, or null at the top level (D1, CHART-HIERARCHY.md). */
  parentId: string | null
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
 * The manual bucket's provider namespace.
 *
 * ⚠️ The honest cost, stated once: the table is called `FinancialSourceAccount`
 * and a manual bucket is not an account at a financial source. `'auxx'` reads as
 * "the source is us", which mostly carries it. The row earns its place by making
 * every other layer uniform - one FK, one picker, one renderer.
 *
 * 🛑 Lives HERE rather than in `source-scope.ts`, which mints the row: this file
 * is client-safe and that one reaches `@auxx/database`. A badge naming a source
 * account has to recognise the manual bucket without pulling a database driver
 * into the browser bundle. `source-scope.ts` re-exports all three.
 */
export const MANUAL_SOURCE_PROVIDER_KEY = 'auxx'

/** The manual bucket's external id within {@link MANUAL_SOURCE_PROVIDER_KEY}. */
export const MANUAL_SOURCE_EXTERNAL_ID = 'manual'

/** What a person sees where a connected source would show its own name. */
export const MANUAL_SOURCE_LABEL = 'Manual'

/** One source a scopable role may be pointed at, as a settings screen renders it. */
export interface RoleSourceRow {
  /**
   * `FinancialSourceAccount.id` for a `store`-axis row - what
   * `GlRoleAssignment.sourceAccountId` holds. For a `rail`-axis row (58 §3
   * rule 6) this is a `payment_gateway` EntityInstance id instead, what
   * `GlRoleAssignment.paymentGatewayId` holds - a different table, same field.
   */
  id: string
  providerKey: string
  externalAccountId: string
  /**
   * The name to show. For a `store`-axis row, from `sourceAccountLabel` - the
   * same helper the settlement list and the processor activity row use, so one
   * account reads the same on every screen.
   *
   * ⚠️ 47 §13.6 said there was no name column and this row had to derive its
   * label. `FinancialSourceAccount.name` landed later (#2178), so the helper
   * prefers it and falls back to the derivation for the unnamed case: a shop
   * domain verbatim, an opaque `gid://` shortened to `Shopify Payments ···3024`.
   * For a `rail`-axis row this is the `payment_gateway` record's own `name`.
   */
  name: string
  /**
   * Which axes this source carries. A `store` comes from EVIDENCE - a row
   * reached through `FinancialSourceObject` - because the same
   * `FinancialSourceAccount` can be both a storefront and, historically, a
   * merchant account; `providerKey` alone cannot settle it. A `rail` (58 §3
   * rule 6) is not evidence at all: it is a live `payment_gateway` record,
   * always exactly `['rail']`, never combined with `'store'` on the same row -
   * the two now come from two different tables.
   */
  axes: ScopeAxis[]
  /** The manual bucket. Pinned first by {@link listRoleSources}. */
  isManual: boolean
}

/**
 * One SOURCE's override of a role, as the settings tree renders it (task 47 §7).
 *
 * 🛑 An override exists only when somebody wrote one. There is no "inherit"
 * row: a source with no override is rendered from the role's own assignment
 * ("Uses 4000 Product Revenue"), which is the same fact stated once rather than
 * copied per source. That is also why `state` has only two values here - a
 * scoped row cannot be `unmapped` (it would not exist) and cannot be `unused`
 * (marking a role unused is a fact about the BUSINESS, so it stays on the role).
 */
export interface RoleSourceAssignmentRow {
  /** `FinancialSourceAccount.id`. Matches a `RoleSourceRow.id` on the same read. */
  sourceAccountId: string
  state: Extract<RoleAssignmentState, 'confirmed' | 'suggested'>
  /** The `gl_account` id this source's revenue lands in. */
  accountId: string
  /** Resolved for display. Null when the account has been archived or deleted. */
  account: ChartAccountRow | null
  source: string | null
  confirmedAt: string | null
}

/**
 * One RAIL's override of a role, and one currency sub-row within it (task 58
 * §3 rule 2, task 59 §2.2) - the rail mirror of {@link RoleSourceAssignmentRow}.
 *
 * Flat, not nested: a rail may carry its own currency-less row, one or more
 * currency rows, or only currency rows and no rail-level row at all - the
 * screen groups by `paymentGatewayId` itself, the same way it groups
 * {@link RoleSourceAssignmentRow} by source.
 */
export interface RoleRailAssignmentRow {
  /** `payment_gateway` EntityInstance id. Matches a `RoleSourceRow.id` on the same read. */
  paymentGatewayId: string
  /** Settlement currency, or null for the rail's own (currency-less) row. */
  currency: string | null
  state: Extract<RoleAssignmentState, 'confirmed' | 'suggested'>
  /** The `gl_account` id this rail's leg lands in. */
  accountId: string
  /** Resolved for display. Null when the account has been archived or deleted. */
  account: ChartAccountRow | null
  source: string | null
  confirmedAt: string | null
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
  /**
   * Which axis of a posted event this role reads its SOURCE from, or null when
   * the role is not scopable at all (task 47 §4).
   *
   * Drives the affordance: only a role with an axis gets a chevron in the
   * settings tree, and it expands to the sources on ITS axis only - a revenue
   * role lists the storefronts and Manual, the fee role lists the merchant
   * accounts. Showing every source under every role would offer a bookkeeper a
   * Stripe account to book product revenue to.
   */
  axis: ScopeAxis | null
  /**
   * The per-source overrides this role carries, ordered by source. Always empty
   * for a role with no axis.
   *
   * ⚠️ The role's OWN `account` above is the default every source without an
   * override falls back to - it is not a separate "Default" entry. That is what
   * makes the settings tree a role row that expands rather than a mode to be in.
   */
  overrides: RoleSourceAssignmentRow[]
  /**
   * The per-rail overrides this role carries (task 58 §3 rule 2), flat and
   * unordered by currency grouping - see {@link RoleRailAssignmentRow}. Always
   * empty for a role whose axis is not `'rail'`.
   */
  railOverrides: RoleRailAssignmentRow[]
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
  /** The provider's own id of the parent account, or null at the top level (CHART-HIERARCHY §6). */
  parentId: string | null
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
    /** The provider's parent id, resolved to a `glAccountId` by the writer's create-order map. Null at the top level or when the parent was skipped. */
    providerParentId: string | null
    accountType: GlAccountTypeValue
    subtype: GlAccountSubtypeValue | null
  }>
  skippedInactive: ProviderAccount[]
  alreadyImported: Array<{ providerAccount: ProviderAccount; glAccountId: string }>
  /**
   * An already-imported account whose provider row now carries a parent this
   * org's chart does not yet reflect (CHART-HIERARCHY §6) - a refresh only
   * ADDS what the provider has, so the writer repoints the parent and, when
   * the account still carries the commit-2a027b6c0 full-path stopgap name,
   * restores the leaf name alongside it.
   */
  reparent: Array<{ glAccountId: string; providerParentId: string; leafName: string | null }>
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
  /** Created under a parent, or an existing account the refresh just repointed under one. */
  nestedUnder: number
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
  /**
   * `open` until somebody locks it.
   *
   * ⚠️ There is no `posted` any more: MIGRATION step 5 deleted the month-end
   * assertion, so closing a month posts nothing and there is no entry for a
   * state to be about. What a close now does is CHECK - see `readCloseBlockers`.
   */
  state: 'open' | 'locked'
}

/** One entry whose lines do not tie, or do not sum to its recorded total. */
export interface BooksBalanceDiscrepancy {
  glPostingId: string
  /** Null only for a draft; balance is checked on posted rows, so this is rare. */
  docNumber: string | null
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

// packages/lib/src/money/credit-memo-posting/types.ts

/**
 * The contract the bulk credit memo posting is written against.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §3, §4, §7.
 *
 * This file is the seam between the halves of the feature and holds no logic:
 *
 * - `reads.ts` finds every unposted memo in a range (the netting read),
 * - `plan.ts` is PURE and groups, excludes and totals them,
 * - `run.ts` posts one entry per group and stamps the memos,
 * - `postings/build-credit-memo-batch-entry.ts` builds the entry for one group,
 * - the router and the dialog render it.
 *
 * The split follows `money/fulfillment-posting/types.ts` exactly, and for the
 * same reason: the decision has to be testable without a database, a clock or
 * a settings read.
 *
 * Client-safe: types and constants only. No `@auxx/database` import.
 */

import type { BatchPostingExclusionReason, BatchPostingGrouping } from '../batch-posting/types'

/** How many memos one posting summarises. One entry per group. */
export type CreditMemoPostingGrouping = BatchPostingGrouping

/**
 * Why a memo in the range produces no posting.
 *
 * The four common reasons (`../batch-posting/types.ts`) plus one of our own.
 *
 * 🛑 **`gateway-ambiguous` and `test-gateway` deliberately do NOT apply here**,
 * and this asymmetry with the fulfillment poster is load-bearing (§7). A sale
 * can be refused and re-run; a refund cannot, because the money has already
 * moved. `resolveSettlementAccount` therefore falls back to `clearing_card` on
 * every uncertainty - no order, no gateway, no match, two records claiming one
 * handle - because that is where a wrong answer fails to reconcile VISIBLY
 * rather than quietly. Do not "fix" that into a refusal.
 *
 * `not-issued` is new: a memo in `draft` or `void` posts nothing, and it is an
 * exclusion rather than a silent filter so the footer's "1,047 of 1,061" has a
 * reason attached to the gap.
 */
export type CreditMemoPostingExclusionReason =
  | BatchPostingExclusionReason
  | 'not-issued'
  | 'missing-contact'

export const CREDIT_MEMO_POSTING_EXCLUSION_REASONS: readonly CreditMemoPostingExclusionReason[] = [
  'before-cutoff',
  'locked-period',
  'foreign-currency',
  'missing-contact',
  'not-issued',
  'zero-value',
]

/**
 * ⚠️ **`missing-contact` is not in brief 25 §7, and is here because BATCHING
 * amplifies it.** `resolveCounterparties` (the QuickBooks provider) refuses an
 * `accounts_receivable`-subtype line carrying no counterparty BEFORE the push.
 * At the single-memo door that costs one document; inside a period entry it
 * would fail the export of every memo in the month. `credit_memo_contact` is
 * `required: true` in the registry, so this should be unreachable - it excludes
 * the one memo rather than letting a data-integrity accident block a close.
 */

/**
 * One memo with no LIVE posting stamped (§4.2): `credit_memo_gl_posting` is
 * null, or names a posting whose status is `reversed`, or names a posting that
 * no longer exists.
 *
 * Everything the planner and the builder need travels on it, so `plan.ts` sees
 * no database.
 */
export interface UnpostedCreditMemo {
  creditMemoId: string
  /** `credit_memo_number`. The doc number of the memo itself, not of the entry. */
  number: string
  /** `YYYY-MM-DD`, the memo's `issuedAt`. The recognition date. */
  issuedAt: string
  /**
   * `credit_memo_status` option id, verbatim.
   *
   * ⚠️ `draft | issued | void` is NOT the whole set: `settle.ts` also writes
   * `settled`. The planner posts `issued` and `settled` and FAILS CLOSED on
   * everything else into `not-issued`, rather than listing the two bad values,
   * so a status added later cannot silently become postable.
   */
  status: string
  /** `credit_memo_source` option id, verbatim: `native` | `channel`. */
  source: string
  /**
   * The memo's currency, verbatim. Blank reads as the ledger currency.
   *
   * ⚠️ There is no `credit_memo_currency` field in the registry. This comes
   * from the memo's ORDER (`order_currency`); a native memo reads `null` and is
   * therefore kept in the ledger currency by definition.
   */
  currency: string | null
  /** `credit_memo_subtotal`, integer minor units. */
  subtotalMinor: number
  /** `credit_memo_tax_total`, integer minor units. */
  taxTotalMinor: number
  /** `credit_memo_total`, integer minor units. */
  totalMinor: number
  /** `credit_memo_amount_refunded`, integer minor units. Drives the settlement leg. */
  amountRefundedMinor: number
  /** The memo's contact. The counterparty frozen onto a per-contact A/R line, never onto a summarised one. */
  contactId: string | null
  /** The memo's order, if any. Resolves the settlement account. */
  orderId: string | null
  /**
   * Whether this memo reverses revenue (§3.1 item 3).
   *
   * Decided by `orderHadFulfillmentBefore` on the READ, not in the planner,
   * because it needs the shipment log. A `channel` memo whose order never
   * shipped before `issuedAt` would otherwise reverse revenue that was never
   * posted - the CM-0091 case.
   */
  reverseRevenue: boolean
}

/** The amounts one memo contributes, all integer minor units. */
export interface CreditMemoAmounts {
  /** Zero when `reverseRevenue` is false: the memo contributes a money leg only. */
  subtotalMinor: number
  /** Zero when `reverseRevenue` is false. */
  taxTotalMinor: number
  /** Zero when `reverseRevenue` is false. */
  totalMinor: number
  /** The refund that actually moved. Always contributed, `reverseRevenue` or not. */
  settlementMinor: number
  /**
   * 🛑 The resolved settlement account, kept PER MEMO and never collapsed.
   *
   * §3.1 item 1: an Affirm memo and a card memo in one group must stay two
   * credit lines, or `1210` is overstated forever in an entry that balances and
   * that nothing downstream can detect. Absent means the `clearing_card` role.
   */
  settlementGlAccountId?: string
  reverseRevenue: boolean
}

/** One memo inside a group, with what it will post. */
export interface PlannedCreditMemo extends UnpostedCreditMemo {
  amounts: CreditMemoAmounts
}

/** One posting the run will make. */
export interface CreditMemoPostingGroup {
  /** The group's identity and the posting's period key before any attempt suffix. */
  groupKey: string
  /** `YYYY-MM-DD`. The latest `issuedAt` in the group. Never a future date. */
  txnDate: string
  memos: PlannedCreditMemo[]
  /** Distinct contacts with an unsettled balance - the A/R leg's line count. */
  contactCount: number
  totals: {
    subtotalMinor: number
    taxTotalMinor: number
    totalMinor: number
    settlementMinor: number
    /** Unsettled remainder, the A/R credit. `totalMinor - settlementMinor` over the group. */
    receivableMinor: number
  }
}

export interface CreditMemoPostingExclusion {
  creditMemoId: string
  number: string
  issuedAt: string
  reason: CreditMemoPostingExclusionReason
  /** The number or value that proves the reason: the cutoff month, the currency, the status. */
  detail: string
}

/** Everything the pure plan is allowed to see. No db, no clock, no settings. */
export interface CreditMemoPostingPlanInput {
  memos: readonly UnpostedCreditMemo[]
  grouping: CreditMemoPostingGrouping
  /** `accounting.cutoffPeriod`, `YYYY-MM`, or null. Memos at or before it are excluded. */
  cutoffPeriod: string | null
  /** `ledger.lockedThroughMonth`, `YYYY-MM`, or null. Memos in a locked month are excluded. */
  lockedThroughMonth: string | null
  /** The one currency the books are kept in. */
  ledgerCurrency: string
  /** `accounting.bookTimeZone`. Carried, never applied: `issuedAt` is already a calendar day. */
  timeZone: string
}

/** What the dialog renders and what the run executes. */
export interface CreditMemoPostingPlan {
  grouping: CreditMemoPostingGrouping
  groups: CreditMemoPostingGroup[]
  exclusions: CreditMemoPostingExclusion[]
  footer: {
    postings: number
    memos: number
    contacts: number
    excluded: number
    totalMinor: number
  }
  /**
   * §8's ordering warning, not a refusal. Non-null when shipments at or before
   * the range end still owe the ledger a posting: issuing contra-revenue first
   * books it against revenue that is not in the books yet. It nets out within
   * the month, so refusing would be stronger than the problem.
   */
  unpostedShipmentWarning: { shipments: number } | null
}

/** The run's input. The plan is recomputed server-side, never client-supplied. */
export interface CreditMemoPostingRequest {
  organizationId: string
  actorUserId: string | null
  /** Half-open on `issuedAt`: `from <= issuedAt < to`, both `YYYY-MM-DD`. */
  range: { from: string; to: string }
  grouping: CreditMemoPostingGrouping
  memo?: string
}

export interface CreditMemoPostingRunSummary {
  /** Groups that now carry a live posting. */
  posted: Array<{ groupKey: string; postingId: string; docNumber: string; memos: number }>
  /** Groups the poster declined without error: `already_posted`, `disabled`, `locked` and the like. */
  skipped: Array<{ groupKey: string; status: string; reason: string }>
  /** Groups that wrote nothing because something threw. Never re-thrown. */
  failed: Array<{ groupKey: string; reason: string }>
  exclusions: CreditMemoPostingExclusion[]
}

/** The posting a memo is stamped with, for the memo's ledger card. */
export interface CreditMemoPostingRef {
  glPostingId: string
  docNumber: string | null
  /** The posting's status when read, so a reversed stamp renders as such. */
  status: 'posted' | 'reversed'
}

/**
 * The `sourceType` the summarised lines of a batch entry carry; `sourceId` is
 * the period key. Mirrors `FULFILLMENT_BATCH_SOURCE_TYPE`.
 *
 * 🛑 This constant is also how `voidCreditMemo` tells a batched memo from a
 * singly-posted one (§2.1). A memo whose live posting carries this source type
 * is not voided in place - the void is REFUSED and the remedy is to reverse the
 * entry and repost the period.
 */
export const CREDIT_MEMO_BATCH_SOURCE_TYPE = 'credit_memo_batch'

/** The registry field holding the `GlPosting` id a memo was posted into (§4.1). */
export const CREDIT_MEMO_GL_POSTING_ATTRIBUTE = 'credit_memo_gl_posting'

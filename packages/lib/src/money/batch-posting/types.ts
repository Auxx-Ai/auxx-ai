// packages/lib/src/money/batch-posting/types.ts

/**
 * The vocabulary the bulk posters share.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §5.
 *
 * 🛑 **Thin on purpose, and it stays thin (§5.0).** Three modules now have the
 * same SHAPE - `builds/backfill-*`, `money/fulfillment-posting/` and
 * `money/credit-memo-posting/` - but their bodies share almost nothing: one
 * posts and stamps a JSON cell, one allocates a run number, one emits record
 * actions. What is genuinely common is the two closed vocabularies below, and
 * that is all this file is allowed to grow into. A generic executor is how this
 * turns into a framework nobody can read.
 *
 * Client-safe: types and constants only. No `@auxx/database` import.
 */

/**
 * How much one posting summarises.
 *
 * 🛑 **`'week'` was removed on 2026-09-11** (brief 25 §6.4) and must not come
 * back. `isoWeekKey` carried the ISO week-NUMBERING year, so `2027-01-01` is
 * `2026-W53` and a New Year's Day shipment minted `AUXX-FUL-2026W53` against a
 * `txnDate` in 2027 - a document number whose period label disagrees with its
 * own entry's fiscal year. A week also reconciles to nothing: it is neither a
 * payout nor a book period, which is why the comparable connectors do not offer
 * it either (§1.1).
 *
 * ⚠️ `builds/backfill-policy.ts` keeps its OWN week grouping and is unaffected.
 * Which groupings a source offers is a property of that source, not a constant
 * in this frame.
 */
export type BatchPostingGrouping = 'day' | 'month'

export const BATCH_POSTING_GROUPINGS: readonly BatchPostingGrouping[] = ['day', 'month']

/**
 * Why a member of the range produces no posting, in the four flavours every
 * source has.
 *
 * A source extends this with its own reasons rather than replacing it - the
 * credit memo poster adds `not-issued`, the fulfillment poster adds
 * `gateway-ambiguous` and `test-gateway`. Closed on purpose (44 §7.2b): a
 * caller renders, counts and tests them exhaustively rather than parsing a
 * sentence, and every exclusion carries the value that proves its reason in its
 * own `detail`.
 *
 * The order is the priority order a planner applies them in, and it is a
 * contract: reporting a member as `zero-value` when it is really in a closed
 * period sends somebody to look at the document instead of at the period.
 */
export type BatchPostingExclusionReason =
  | 'before-cutoff'
  | 'locked-period'
  | 'foreign-currency'
  | 'zero-value'

export const BATCH_POSTING_EXCLUSION_REASONS: readonly BatchPostingExclusionReason[] = [
  'before-cutoff',
  'locked-period',
  'foreign-currency',
  'zero-value',
]

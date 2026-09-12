// packages/lib/src/money/credit-memo-posting/plan.ts

/**
 * What the bulk credit memo run would post, decided with nothing but the memos
 * and four settings.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §3, §7 and §8.
 *
 * 🛑 **PURE, and that is the whole point.** No database, no clock, no settings
 * read, no writer. It is handed every memo in a range that no live posting
 * claims, the cutoff, the lock, the ledger currency and the book time zone, and
 * it returns the postings it would make and the memos it would not. The split
 * is `money/fulfillment-posting/plan.ts`'s, for the same reason: the painful
 * cases here are a memo whose order never shipped before it was issued, a memo
 * dated inside a closed period, and a group that mixes the two. Every one of
 * those is a unit test only while the decision needs nothing to run.
 *
 * ## The exclusion order is a priority order, not a filter chain
 *
 * A memo is excluded ONCE, for the FIRST reason that applies, and the reasons
 * are ordered by which remedy the person has to reach for:
 *
 * 1. `not-issued` - a `void` memo posts nothing, ever, and so does a `draft`
 *    unless {@link CreditMemoPostingPlanInput.issueDrafts} is set. It is an
 *    exclusion rather than a silent filter so the footer's "1,047 of 1,061" has
 *    a reason attached to the gap (§7).
 * 2. `before-cutoff` - covered by the opening balance; nothing to do, ever.
 * 3. `locked-period` - reopen the month, or leave it.
 * 4. `foreign-currency` - the books are kept in one currency.
 * 5. `missing-contact` - fix the record. `resolveCounterparties` refuses an
 *    `accounts_receivable`-subtype line carrying no counterparty BEFORE the
 *    push, so inside a period entry one such memo would fail the export of
 *    every memo in the month (`types.ts`).
 * 6. `missing-number` - fix the record, and only ever for a memo this run would
 *    ISSUE. See {@link CreditMemoPostingPlanInput.issueDrafts} below.
 * 7. `zero-value` - a memo that credits nothing, or whose amounts the shared
 *    arithmetic refuses to compute.
 *
 * Reporting a memo as `zero-value` when it is really in a closed period sends
 * somebody to look at the document instead of at the period, so the order of
 * these `if`s IS the contract. Every row carries the value that proves its
 * reason in `detail`, which is 44 §7.2b's rule.
 *
 * ## 🛑 A planned draft must pass the refusals `resolveIssue` would apply
 *
 * With `issueDrafts`, `run.ts` issues each `draft` member through
 * `issueCreditMemo(..., { post: false })` BEFORE it builds the group's entry, so
 * a draft the single-memo door would refuse is not a member this planner may
 * promise. The three refusals `resolveIssue` makes that the netting read already
 * carries the data for are checked here, in its own order (contact, then number,
 * then a non-positive total - the last one is `computeCreditMemoAmounts`'s and
 * therefore already applies to every memo): a `missing-number` draft is refused
 * because the SINGLE-memo entry keys its document number on the memo number, and
 * finding that out one memo at a time during the run would drop it from a group
 * whose entry had already been dimensioned. The refusals this planner CANNOT
 * make - an empty line set, a channel memo with no refund date - are the run's,
 * and land in `CreditMemoPostingRunSummary.issued.failed`.
 *
 * 🛑 **`gateway-ambiguous` and `test-gateway` deliberately do not exist here**
 * (§7, and `types.ts` says it at length). A sale can be refused and re-run; a
 * refund cannot, because the money has already moved. The settlement account is
 * resolved before the plan and falls back to the `clearing_card` role on every
 * uncertainty, which is where a wrong answer fails to reconcile VISIBLY. Do not
 * "fix" that into a refusal.
 *
 * ## Grouping is calendar arithmetic on a string, and needs no time zone
 *
 * `issuedAt` is already a calendar date in the book zone - the memo carries the
 * day the refund happened, not an instant. So the day bucket is the string
 * itself and the month bucket is its first seven characters.
 * {@link CreditMemoPostingPlanInput.timeZone} is therefore carried but never
 * applied here: re-zoning a date that is already local is how a memo moves a day
 * and lands in the wrong month.
 */

import type { CreditMemoSettlement as CreditMemoSettlementLeg } from '../../postings/build-credit-memo-entry'
import { computeCreditMemoAmounts } from '../../postings/build-credit-memo-entry'
import type {
  CreditMemoAmounts,
  CreditMemoPostingExclusion,
  CreditMemoPostingGroup,
  CreditMemoPostingGrouping,
  CreditMemoPostingPlan,
  CreditMemoPostingPlanInput,
  PlannedCreditMemo,
  UnpostedCreditMemo,
} from './types'

/**
 * The two facts the planner needs that are neither a memo nor a setting.
 *
 * 🛑 They are an INTERSECTION rather than members of
 * {@link CreditMemoPostingPlanInput}, which is the shape
 * `planFulfillmentPosting` already uses for its `gatewayRoutes`. Both are
 * resolved by a database read the pure planner must not make, both are optional,
 * and a caller that omits them gets an honest (if less dimensioned) plan rather
 * than a refusal.
 */
export interface CreditMemoPlanContext {
  /**
   * `creditMemoId -> the settlement account the refund comes back out of`.
   *
   * Absent for a memo means the `clearing_card` role, which is
   * `resolveSettlementAccount`'s own fallback. §3.1 item 1: the map is kept PER
   * MEMO and the builder never collapses it, because an Affirm memo and a card
   * memo in one group must stay two credit lines or `1210` is overstated forever
   * in an entry that balances.
   */
  settlementAccounts?: ReadonlyMap<string, string>
  /**
   * §8's ordering warning: how many shipments at or before the range end still
   * owe the ledger a posting. A WARNING, never a refusal - issuing contra-revenue
   * first books it against revenue that is not in the books yet, and it nets out
   * within the month, so refusing would be stronger than the problem.
   */
  unpostedShipments?: number
}

/**
 * Decide what the run would post.
 *
 * The output is deterministic - groups ascending by key, memos within a group by
 * issue date then memo number then id, exclusions in the same order - which is
 * what lets a test assert on the whole structure and what keeps a preview stable
 * between two runs against unchanged data.
 *
 * Never throws. Total on every input, including a memo whose stored totals do
 * not sum or whose refund exceeds its credit: an amount the shared arithmetic
 * refuses to compute is reported as an exclusion rather than taken out on the
 * rest of the range. That matters more here than in the single-memo door, where
 * one refusal costs one document.
 */
export function planCreditMemoPosting(
  input: CreditMemoPostingPlanInput & CreditMemoPlanContext
): CreditMemoPostingPlan {
  const { grouping, cutoffPeriod, lockedThroughMonth, ledgerCurrency, settlementAccounts } = input

  const exclusions: CreditMemoPostingExclusion[] = []
  const byGroupKey = new Map<string, PlannedCreditMemo[]>()

  for (const memo of [...input.memos].sort(compareMemos)) {
    // Whether THIS run would flip the memo to `issued` on its way to the entry.
    // ⚠️ `draft` and nothing else: a `void` memo is never resurrected, and an
    // option id nobody has taught this module about is not a draft either.
    const issuing = input.issueDrafts && memo.status === 'draft'

    // 🛑 FIRST. A memo the run will not issue and that is not already issued is
    // not a document the ledger has any opinion about, so reporting it as
    // `before-cutoff` or `zero-value` would send somebody to the period or to
    // the lines when the answer is "issue it".
    if (!issuing && memo.status !== 'issued' && memo.status !== 'settled') {
      exclusions.push(exclude(memo, 'not-issued', memo.status))
      continue
    }

    const month = monthOf(memo.issuedAt)
    if (cutoffPeriod && month <= cutoffPeriod) {
      exclusions.push(exclude(memo, 'before-cutoff', cutoffPeriod))
      continue
    }
    if (lockedThroughMonth && month <= lockedThroughMonth) {
      exclusions.push(exclude(memo, 'locked-period', lockedThroughMonth))
      continue
    }
    // Blank reads as the ledger currency: a memo the channel sent no currency
    // for is not a foreign memo, it is a memo with an unfilled cell.
    const currency = memo.currency?.trim() || ledgerCurrency
    if (currency !== ledgerCurrency) {
      exclusions.push(exclude(memo, 'foreign-currency', currency))
      continue
    }
    if (!memo.contactId) {
      exclusions.push(exclude(memo, 'missing-contact', 'credit_memo_contact is empty'))
      continue
    }
    // 🛑 Only for a memo this run would ISSUE, and that asymmetry is deliberate.
    // A BATCH entry keys its document number on the period, so an already-issued
    // memo with an unallocated number posts perfectly well inside one; the
    // SINGLE-memo entry `resolveIssue` refuses without a number does not, and
    // `run.ts` issues every draft through that door before it builds the group.
    if (issuing && memo.number.trim().length === 0) {
      exclusions.push(exclude(memo, 'missing-number', 'credit_memo_number is empty'))
      continue
    }

    const computed = computeAmounts(memo, settlementAccounts?.get(memo.creditMemoId))
    if (!computed.ok) {
      // 🛑 Classified as `zero-value` on purpose. The reason set is CLOSED
      // (`types.ts`), and a memo whose amounts cannot be computed contributes
      // exactly nothing to a posting, which is what `zero-value` means to the
      // run. `detail` carries the refusal verbatim, so the screen still names
      // the actual problem instead of claiming the memo credits nothing.
      exclusions.push(exclude(memo, 'zero-value', computed.reason))
      continue
    }
    const { amounts } = computed
    // ⚠️ NOT `totalMinor <= 0`, which is the fulfillment poster's test and is
    // wrong here: §3.1 item 3's `reverseRevenue: false` member has a total of
    // zero BY CONSTRUCTION and still posts a money leg. A memo contributes
    // nothing only when neither half moves - unreachable today, because
    // `computeCreditMemoAmounts` already refuses a zero total and a memo with
    // neither a revenue leg nor a settlement, and kept so this stays total.
    if (amounts.totalMinor === 0 && amounts.settlementMinor === 0) {
      exclusions.push(exclude(memo, 'zero-value', String(amounts.totalMinor)))
      continue
    }

    const key = groupKeyFor(memo.issuedAt, grouping)
    const bucket = byGroupKey.get(key)
    if (bucket) bucket.push({ ...memo, amounts })
    else byGroupKey.set(key, [{ ...memo, amounts }])
  }

  const groups = [...byGroupKey.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([groupKey, memos]) => collapseCreditMemoGroup(groupKey, memos))

  const contacts = new Set<string>()
  let drafts = 0
  for (const group of groups) {
    for (const memo of group.memos) {
      if (memo.contactId) contacts.add(memo.contactId)
      // Counted off the PLANNED members, never off the input: a draft the plan
      // excluded is not a document state this run changes.
      if (memo.status === 'draft') drafts += 1
    }
  }

  const unpostedShipments = input.unpostedShipments ?? 0

  return {
    grouping,
    groups,
    exclusions,
    footer: {
      postings: groups.length,
      memos: groups.reduce((total, group) => total + group.memos.length, 0),
      // ⚠️ Every distinct contact the run TOUCHES, which is deliberately not
      // `Σ group.contactCount`: that one counts the A/R lines an entry will
      // carry, and a fully refunded channel memo produces none.
      contacts: contacts.size,
      drafts,
      excluded: exclusions.length,
      totalMinor: groups.reduce((total, group) => total + group.totals.totalMinor, 0),
    },
    unpostedShipmentWarning: unpostedShipments > 0 ? { shipments: unpostedShipments } : null,
  }
}

/**
 * The identity of the posting one memo falls into, and its period key before any
 * attempt suffix.
 *
 * Exported because the preview, the run and the dialog all have to agree about
 * which posting a memo belongs to, and a second copy of this three-line function
 * is a second thing that can drift.
 */
export function groupKeyFor(issuedAt: string, grouping: CreditMemoPostingGrouping): string {
  if (grouping === 'month') return monthOf(issuedAt)
  return issuedAt
}

/**
 * Collapse one bucket of memos into the posting it becomes.
 *
 * 🛑 Exported for `run.ts`, which RE-collapses a group after a `draft` member
 * failed to issue and had to be dropped from it. Every number an entry carries -
 * the totals, the A/R line count, the transaction date - is derived here from
 * the members alone, so rebuilding the group through this same function is what
 * keeps a dropped member out of an entry that would otherwise still claim its
 * amounts. A second copy of this arithmetic in the runner would be free to
 * disagree with the plan the dialog showed.
 */
export function collapseCreditMemoGroup(
  groupKey: string,
  memos: PlannedCreditMemo[]
): CreditMemoPostingGroup {
  let subtotalMinor = 0
  let taxTotalMinor = 0
  let totalMinor = 0
  let settlementMinor = 0
  let txnDate = ''
  /** Contact id -> its net unsettled remainder. The A/R leg, line for line. */
  const receivableByContact = new Map<string, number>()

  for (const memo of memos) {
    subtotalMinor += memo.amounts.subtotalMinor
    taxTotalMinor += memo.amounts.taxTotalMinor
    totalMinor += memo.amounts.totalMinor
    settlementMinor += memo.amounts.settlementMinor
    if (memo.contactId) {
      const unsettled = memo.amounts.totalMinor - memo.amounts.settlementMinor
      receivableByContact.set(
        memo.contactId,
        (receivableByContact.get(memo.contactId) ?? 0) + unsettled
      )
    }
    // 🛑 The LATEST issue date in the group, never the group key's own start. A
    // month bucket posted on the first would date the whole month's returns into
    // the day the period opened, before some of the refunds happened. The latest
    // date is inside the period by construction and is never in the future,
    // because a memo cannot be issued before it exists.
    if (memo.issuedAt > txnDate) txnDate = memo.issuedAt
  }

  let contactCount = 0
  for (const amount of receivableByContact.values()) {
    // Zero nets produce no line: the builder drops them, so counting them would
    // promise the reader an A/R leg the entry does not carry.
    if (amount !== 0) contactCount += 1
  }

  return {
    groupKey,
    txnDate,
    memos,
    contactCount,
    totals: {
      subtotalMinor,
      taxTotalMinor,
      totalMinor,
      settlementMinor,
      receivableMinor: totalMinor - settlementMinor,
    },
  }
}

/**
 * `computeCreditMemoAmounts`, made total.
 *
 * 🛑 The ONE per-memo arithmetic, shared with the single-memo door (§9 item 9),
 * so a batched January and the same memo posted on its own can never disagree
 * about what it credits. It throws an `UnprocessableEntityError` on a stored
 * total that does not sum, a refund larger than the credit or a fractional
 * amount, which is the right answer for one memo a person is issuing and the
 * wrong one for a run over a thousand. Catching it here is what keeps
 * {@link planCreditMemoPosting} total, and the refusal sentence is kept so the
 * exclusion can carry it verbatim.
 */
function computeAmounts(
  memo: UnpostedCreditMemo,
  settlementGlAccountId: string | undefined
): { ok: true; amounts: CreditMemoAmounts } | { ok: false; reason: string } {
  try {
    return {
      ok: true,
      amounts: computeCreditMemoAmounts({
        creditMemoId: memo.creditMemoId,
        number: memo.number,
        subtotal: memo.subtotalMinor,
        taxTotal: memo.taxTotalMinor,
        total: memo.totalMinor,
        reverseRevenue: memo.reverseRevenue,
        ...(settlementFor(memo, settlementGlAccountId) ?? {}),
      }),
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The channel money leg: what the channel already paid back, and out of which
 * account.
 *
 * ⚠️ **`source === 'channel'` is load-bearing**, and is the single-memo door's
 * own gate (`resolveIssue`). A NATIVE memo's refund moves as a
 * `PaymentTransaction` and posts through the payment builder, so crediting a
 * clearing account here as well would refund the same money twice in the books.
 */
function settlementFor(
  memo: UnpostedCreditMemo,
  settlementGlAccountId: string | undefined
): { settlement: CreditMemoSettlementLeg } | undefined {
  if (memo.source !== 'channel') return undefined
  const amount = Math.round(memo.amountRefundedMinor)
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  return {
    settlement: settlementGlAccountId
      ? { glAccountId: settlementGlAccountId, amount }
      : { role: 'clearing_card', amount },
  }
}

function exclude(
  memo: UnpostedCreditMemo,
  reason: CreditMemoPostingExclusion['reason'],
  detail: string
): CreditMemoPostingExclusion {
  return {
    creditMemoId: memo.creditMemoId,
    number: memo.number,
    issuedAt: memo.issuedAt,
    reason,
    detail,
  }
}

/** `YYYY-MM` of a `YYYY-MM-DD`. Month keys compare as strings, chronologically. */
function monthOf(issuedAt: string): string {
  return issuedAt.slice(0, 7)
}

function compareMemos(a: UnpostedCreditMemo, b: UnpostedCreditMemo): number {
  return (
    compareStrings(a.issuedAt, b.issuedAt) ||
    compareStrings(a.number, b.number) ||
    compareStrings(a.creditMemoId, b.creditMemoId)
  )
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

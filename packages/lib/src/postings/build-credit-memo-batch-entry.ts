// packages/lib/src/postings/build-credit-memo-batch-entry.ts

/**
 * ONE credit memo entry for a whole day or month of memos.
 *
 * PURE. No database, no clock, no chart, no settings read - the property every
 * builder in this folder has, and here it is what lets a mixed group of card,
 * routed-gateway, unsettled and pre-fulfillment memos be balanced exhaustively
 * in a unit test.
 *
 * ```
 *   Dr revenue_returns_allowances   summarised                      Σ subtotal
 *   Dr sales_tax_payable            summarised                      Σ tax
 *       Cr clearing_card                summarised                  Σ settled
 *       Cr <gateway's own account>      summarised PER ACCOUNT ID   Σ settled
 *       Cr accounts_receivable          ONE LINE PER CONTACT        Σ unsettled
 * ```
 *
 * ## Why this exists beside {@link buildCreditMemoEntry}
 *
 * `buildCreditMemoEntry` posts ONE memo and keys on the memo's own number, so
 * every memo becomes a `GlPosting` and - because `credit_memo` exports as a
 * journal - one journal entry in QuickBooks. DemoOrg1 carries 1,061 channel
 * memos, which is a thousand journal entries in a live company and the exact
 * row shape `plans/money/tasks/45-batch-only-builds.md` §0 refused for builds.
 * Brief 25 §1 answers it the way brief 49 answered it for shipments: batch in
 * the ledger, one posting per period, `AUXX-CRM-202601` beside `AUXX-FUL-202601`.
 *
 * Both builders share ONE implementation of the per-memo arithmetic
 * (`computeCreditMemoAmounts`), so a batched January and the same memo posted
 * on its own can never disagree about what it credits.
 *
 * ## Three things that must not summarise away (§3.1)
 *
 * 1. **The settlement credit stays per resolved account id.** A
 *    `payment_gateway` record routes a non-card rail to its own clearing
 *    account by id, so an Affirm memo and a card memo in one group stay TWO
 *    credit lines. Collapse them and `1210` is overstated forever in an entry
 *    that still balances and that nothing downstream can detect.
 *    `CreditMemoAmounts.settlementGlAccountId` absent means the `clearing_card`
 *    role.
 * 2. **The A/R leg stays per counterparty.** Aging has to name the debtor, and
 *    `resolveCounterparties` refuses an `accounts_receivable`-subtype line with
 *    no counterparty. For an all-channel group this is usually zero lines,
 *    because the money already went back.
 * 3. **`reverseRevenue: false` members contribute a money leg ONLY.** A channel
 *    memo whose order never shipped before `issuedAt` reverses revenue that was
 *    never posted (the CM-0091 case, §8.2). They are NOT split into their own
 *    group: their subtotal and tax are already zeroed by
 *    `computeCreditMemoAmounts`, their settlement still credits a clearing
 *    account, and their share of the A/R leg is therefore NEGATIVE - a DEBIT,
 *    exactly as the single-memo builder's money leg is `Dr accounts_receivable
 *    / Cr clearing_card`. One group, correct arithmetic.
 *
 * ## 🛑 `gateway-ambiguous` and `test-gateway` deliberately do NOT apply here
 *
 * This asymmetry with the fulfillment batch builder is load-bearing (§7) and
 * somebody will eventually try to "fix" it into a refusal. A sale can be
 * refused and re-run; a refund cannot, because the money has already moved.
 * `resolveSettlementAccount` therefore falls back to `clearing_card` on every
 * uncertainty - no order, no gateway, no match, two records claiming one handle
 * - because that is where a wrong answer fails to reconcile VISIBLY rather than
 * quietly. This builder has no gateway fork at all: the account was resolved
 * once per memo, before the group was built, and is frozen onto `amounts`.
 *
 * ## What this builder does NOT dimension
 *
 * §3's sketch shows the contra-revenue leg per channel and the tax leg per
 * jurisdiction, the way `build-fulfillment-batch-entry.ts` splits them.
 * `UnpostedCreditMemo` and `CreditMemoAmounts` carry neither the memo's channel
 * nor its tax lines, so both legs are single summarised lines here. Adding a
 * split is a change to the netting read first, this builder second - and a
 * PARTIAL breakdown would read as a complete one, which is the reason
 * `splitTaxByJurisdiction` exists at all.
 *
 * ## `sources` is an AUDIT RECORD and has no readers (§2.1)
 *
 * Summarised lines name a period key, not 312 memos, so `BuiltEntry.sources`
 * carries `{creditMemoId, number, amounts}` per member into the posting's
 * `draft` envelope. ⚠️ **Nothing in product code has ever read `sources` back**,
 * on this builder or on the fulfillment one, and no feature may be designed on
 * top of it until something proves the read round-trips out of a stored row. In
 * particular it is NOT the input to a per-member compensating entry: §2.1 drops
 * that outright, and `voidCreditMemo` refuses on a summarised posting instead.
 *
 * @see plans/accounting/tasks/25-batch-posting-and-credit-memos.md §2.1, §3, §7
 */

import { UnprocessableEntityError } from '../errors'
import type { CreditMemoAmounts, CreditMemoPostingGroup } from '../money/credit-memo-posting/types'
import { CREDIT_MEMO_BATCH_SOURCE_TYPE } from '../money/credit-memo-posting/types'
import { CREDIT_MEMO_POSTING_TYPE } from './build-credit-memo-entry'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from './doc-number'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * The `sourceType` a per-contact A/R line carries; `sourceId` is the contact's
 * `EntityInstance` id.
 *
 * The mirror of the fulfillment A/R leg keeping `sourceType: 'order'` (49 §2.5):
 * the summarised legs name the period key, and the one leg that stays at
 * document grain names the thing aging has to report on.
 */
export const CREDIT_MEMO_CONTACT_SOURCE_TYPE = 'contact'

// ── The period key ──────────────────────────────────────────────────────────

/** `AUXX-CRM-`, built from the declared prefix rather than typed twice. */
const CREDIT_MEMO_DOC_PREFIX = `AUXX-${DOC_NUMBER_PREFIX.credit_memo}-`

/**
 * How many characters of compacted period key a credit memo document number
 * holds, with room for a reversal.
 *
 * `AUXX-CRM-` is 9 and `-R9` is 3, so 9 are left of the 21-character cap. The
 * budget is exactly enough:
 *
 * | grouping | key | compacted | plus an attempt char |
 * |---|---|---|---|
 * | day | `2026-01-14` | 8 | 9 |
 * | month | `2026-01` | 6 | 7 |
 *
 * 🛑 The `-R9` headroom is the half that is easy to drop and the worst to get
 * wrong: a key that compacts to 12 posts perfectly at revision 0 and REFUSES
 * the day somebody reverses it, leaving an entry in the books with no way to
 * take it out. That matters more here than anywhere: §2.1 makes
 * reverse-and-repost the ONLY correction path for a batched memo, so a key that
 * cannot be reversed is a group that can never be fixed.
 */
export const MAX_COMPACT_CREDIT_MEMO_BATCH_KEY =
  DOC_NUMBER_MAX_LENGTH - CREDIT_MEMO_DOC_PREFIX.length - '-R9'.length

/** The longest compacted group key the plan can produce: a day, `20260114`. */
const MAX_GROUP_KEY_COMPACT_LENGTH = 8

/**
 * 36 attempts, which is what one base-36 character of key budget holds. The
 * same ceiling, for the same arithmetic, as `MAX_FULFILLMENT_BATCH_ATTEMPT`.
 */
export const MAX_CREDIT_MEMO_BATCH_ATTEMPT = 35

/**
 * The period key for one batch posting: the group key, plus an attempt.
 *
 * `fulfillmentBatchPeriodKey`'s scheme, byte for byte (§3.2). It is duplicated
 * rather than imported because the two differ in their prefix, their budget
 * assertion and their refusal text, and §5 is where the pair is eventually
 * generalised into the shared frame - not by one importing the other.
 *
 * ## Why the attempt exists
 *
 * `(organizationId, postingType, periodKey, revision)` is the claim's unique
 * index and a duplicate comes back `already_posted` - a SUCCESS status that
 * posts nothing. A month key claims its month ONCE, so a memo issued late into
 * an already-posted January would silently recognise nothing while the run
 * reported that it had.
 *
 * - **attempt 0** is the group key verbatim, byte for byte. Load-bearing: the
 *   key is half the uniqueness tuple, so re-keying it would make every posting
 *   already in a ledger invisible to the idempotency check.
 * - **attempt 1..35** appends one base-36 character. `buildDocNumber` strips
 *   hyphens and nothing else, so there is no separator to spend and the
 *   character is simply appended: `2026-01` attempt 1 mints `2026-011` and the
 *   document number `AUXX-CRM-2026011`.
 *
 * ⚠️ The run allocates the attempt by COUNTING the live postings whose period
 * key is this group's - never by retrying on a conflict, because
 * `already_posted` is not an error to retry. That is also what keeps the
 * category's most documented failure mode (duplicates on a rollback-and-resend)
 * off this path, §1.1.
 *
 * @throws {UnprocessableEntityError} on a blank group key, an attempt outside
 *   `0..35`, or a key that would not survive a reversal inside the cap.
 */
export function creditMemoBatchPeriodKey(groupKey: string, attempt: number): string {
  const key = groupKey.trim()
  if (!key) {
    throw new UnprocessableEntityError(
      'A batch credit memo posting needs a group key (a day or a month) to key its document ' +
        'number on.'
    )
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new UnprocessableEntityError(
      `A credit memo batch attempt must be a whole number from 0, got ${String(attempt)}`,
      { groupKey: key, attempt: String(attempt) }
    )
  }
  if (attempt > MAX_CREDIT_MEMO_BATCH_ATTEMPT) {
    throw new UnprocessableEntityError(
      `Period ${key} has already produced ${attempt} credit memo postings, which is more than the ` +
        'document-number keyspace can hold. Post the remainder under a narrower grouping.',
      { groupKey: key, attempt: String(attempt) }
    )
  }

  // 🛑 Asserted rather than assumed: a day key plus one attempt character is
  // exactly the whole budget, so any widening of the prefix or the reversal
  // suffix breaks the late-memo case and nothing else would say so.
  if (MAX_COMPACT_CREDIT_MEMO_BATCH_KEY < MAX_GROUP_KEY_COMPACT_LENGTH + 1) {
    throw new UnprocessableEntityError(
      `The credit memo document-number budget is ${MAX_COMPACT_CREDIT_MEMO_BATCH_KEY} compacted ` +
        `characters and a day key plus one attempt character needs ` +
        `${MAX_GROUP_KEY_COMPACT_LENGTH + 1}. A memo issued late into a posted day could not be ` +
        'keyed at all.',
      { budget: String(MAX_COMPACT_CREDIT_MEMO_BATCH_KEY) }
    )
  }

  const periodKey = attempt === 0 ? key : `${key}${attempt.toString(36).toUpperCase()}`
  const compact = periodKey.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_CREDIT_MEMO_BATCH_KEY) {
    throw new UnprocessableEntityError(
      `Period key "${periodKey}" compacts to ${compact.length} characters and a credit memo ` +
        `document number allows ${MAX_COMPACT_CREDIT_MEMO_BATCH_KEY} (${DOC_NUMBER_MAX_LENGTH} ` +
        'total, less "AUXX-CRM-" and a reversal suffix).',
      { groupKey: key, periodKey, attempt: String(attempt), length: String(compact.length) }
    )
  }
  return periodKey
}

// ── The entry ───────────────────────────────────────────────────────────────

/**
 * One memo as the entry froze it. Rides in `BuiltEntry.sources`.
 *
 * ⚠️ An audit record with no readers. See the file header.
 */
export interface CreditMemoBatchSource {
  creditMemoId: string
  /** The memo's own number (`'CM-0091'`), so a reader needs no second lookup. */
  number: string
  amounts: CreditMemoAmounts
}

export interface BuildCreditMemoBatchEntryInput {
  /** The group to post. Its memos already carry their `amounts`. */
  group: CreditMemoPostingGroup
  /** The one currency the books are kept in. Passed in so this file stays pure. */
  ledgerCurrency: string
  /**
   * 0 on the first claim of this group key; n appends a base-36 attempt
   * character. See {@link creditMemoBatchPeriodKey}.
   */
  attempt: number
  /** Carried onto every line. Defaults to the group key. */
  memo?: string
}

export interface BuiltCreditMemoBatchEntry {
  entry: BuiltEntry
  /** `creditMemoBatchPeriodKey(group.groupKey, attempt)`. Also `entry.periodKey`. */
  periodKey: string
  /** Recomputed from the memos actually posted, not copied off the group. */
  totals: CreditMemoPostingGroup['totals']
}

/** Assert a frozen amount is whole minor units before it decides a ledger line. */
function assertWholeMinor(value: number, label: string, context: Record<string, string>): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `${label} is ${String(value)}, which is not a whole number of cents.`,
      context
    )
  }
  return value
}

/**
 * Build ONE entry for a whole group of credit memos.
 *
 * ## It balances BY CONSTRUCTION
 *
 * Every debit is a memo's contra-revenue and tax; every credit is the same
 * memo's `totalMinor` decomposed into what the channel paid back and what is
 * still owed. Per memo:
 *
 * ```
 *   debits  = subtotal + tax                       = total
 *   credits = settlement + (total - settlement)    = total
 * ```
 *
 * so `Σ debits === Σ credits` before `buildEntry` is reached and its own gate
 * can only ever confirm it. `total === subtotal + tax` is re-asserted on each
 * frozen `amounts` below, and that re-assertion is the load-bearing half: the
 * debits use the parts and the credits use the total, so an `amounts` whose
 * parts do not sum to its total would produce an entry that genuinely does not
 * balance.
 *
 * A `reverseRevenue: false` member falls out of the same arithmetic with no
 * branch: its three revenue numbers are zero, so it contributes no debit, a
 * settlement credit, and `0 - settlement` to its contact's A/R - a DEBIT.
 *
 * Zero legs are dropped rather than posted at zero, because `buildEntry`
 * refuses a zero amount outright.
 *
 * ## What each line is sourced on
 *
 * Every summarised line carries `sourceType: 'credit_memo_batch'` and
 * `sourceId: <periodKey>`; the per-contact A/R lines carry
 * `sourceType: 'contact'` and the contact's id, plus the counterparty aging
 * needs. A memo with no contact has nowhere to attribute its remainder, so it
 * joins one undimensioned A/R line under the batch source rather than being
 * dropped - the same fail-open the single-memo builder takes, which posts an
 * uncounterpartied receivable rather than refusing.
 *
 * 🛑 A memo whose posting carries `credit_memo_batch` is NOT voided in place
 * (§2.1): `voidCreditMemo` refuses and names this entry, because reversing it
 * would un-book every other member.
 *
 * @throws {UnprocessableEntityError} on an empty group, a memo in a foreign
 *   currency, a frozen amount that is not whole minor units or does not sum to
 *   its own total, a `reverseRevenue: false` member carrying revenue, or a
 *   period key that would not survive a reversal. None of these is a
 *   member-level exclusion: the planner has already removed those, and each of
 *   these is an entry that could not balance.
 */
export function buildCreditMemoBatchEntry(
  input: BuildCreditMemoBatchEntryInput
): BuiltCreditMemoBatchEntry {
  const { group, ledgerCurrency, attempt, memo } = input

  if (group.memos.length === 0) {
    throw new UnprocessableEntityError(
      `Group ${group.groupKey} holds no credit memos. A credit memo posting reverses what was ` +
        'credited, so there is nothing to post and the period must not be claimed.',
      { groupKey: group.groupKey }
    )
  }

  const periodKey = creditMemoBatchPeriodKey(group.groupKey, attempt)

  // ── Accumulate ───────────────────────────────────────────────────────────
  /** A `payment_gateway` route's own clearing account id -> its summarised credit. */
  const settlementByAccount = new Map<string, number>()
  /** Contact id, or null for the unattributed remainder -> `Σ (total - settled)`. */
  const receivableByContact = new Map<string | null, number>()
  const sources: CreditMemoBatchSource[] = []
  let clearingCardMinor = 0
  let subtotalMinor = 0
  let taxTotalMinor = 0
  let totalMinor = 0
  let settlementMinor = 0

  for (const planned of group.memos) {
    const context = {
      groupKey: group.groupKey,
      creditMemoId: planned.creditMemoId,
      number: planned.number,
    }

    // A silent 1.0 rate is unrecoverable: the entry balances, the trial balance
    // ties, and the contra-revenue is the wrong number in the wrong unit. The
    // plan excludes a foreign memo before it ever gets here; this is the assert.
    const currency = planned.currency?.trim() || ledgerCurrency
    if (currency !== ledgerCurrency) {
      throw new UnprocessableEntityError(
        `Credit memo ${planned.number} is in ${currency} and the ledger is kept in ` +
          `${ledgerCurrency}. Posting it would use an implied 1.0 rate.`,
        { ...context, currency, ledgerCurrency }
      )
    }

    const amounts = planned.amounts
    assertWholeMinor(amounts.subtotalMinor, `Subtotal on credit memo ${planned.number}`, context)
    assertWholeMinor(amounts.taxTotalMinor, `Tax on credit memo ${planned.number}`, context)
    assertWholeMinor(amounts.totalMinor, `Total on credit memo ${planned.number}`, context)
    assertWholeMinor(
      amounts.settlementMinor,
      `Settlement on credit memo ${planned.number}`,
      context
    )

    const parts = amounts.subtotalMinor + amounts.taxTotalMinor
    if (parts !== amounts.totalMinor) {
      throw new UnprocessableEntityError(
        `Credit memo ${planned.number} carries a total of ${amounts.totalMinor} and a subtotal ` +
          `plus tax of ${parts}. The debits are the parts and the credits are the total, so the ` +
          'entry could not balance.',
        { ...context, totalMinor: String(amounts.totalMinor), parts: String(parts) }
      )
    }
    if (amounts.settlementMinor < 0) {
      throw new UnprocessableEntityError(
        `Credit memo ${planned.number} says ${amounts.settlementMinor} was refunded at the ` +
          'channel. A settlement is never negative - the sign lives in the line direction.',
        { ...context, settlementMinor: String(amounts.settlementMinor) }
      )
    }
    // §3.1 item 3. `computeCreditMemoAmounts` zeroes these, so a non-zero here
    // is a hand-built `amounts` that would book contra-revenue against revenue
    // which was never recognised - and the entry would still balance.
    if (!amounts.reverseRevenue && amounts.totalMinor !== 0) {
      throw new UnprocessableEntityError(
        `Credit memo ${planned.number} reverses no revenue but carries ${amounts.totalMinor} of ` +
          'it. A memo whose order never shipped before it was issued contributes a money leg only.',
        { ...context, totalMinor: String(amounts.totalMinor) }
      )
    }

    subtotalMinor += amounts.subtotalMinor
    taxTotalMinor += amounts.taxTotalMinor
    totalMinor += amounts.totalMinor
    settlementMinor += amounts.settlementMinor

    // 🛑 §3.1 item 1: PER RESOLVED ACCOUNT ID, never collapsed into the role.
    if (amounts.settlementGlAccountId) {
      const glAccountId = amounts.settlementGlAccountId
      settlementByAccount.set(
        glAccountId,
        (settlementByAccount.get(glAccountId) ?? 0) + amounts.settlementMinor
      )
    } else {
      clearingCardMinor += amounts.settlementMinor
    }

    // §3.1 item 2: PER COUNTERPARTY. Negative for a `reverseRevenue: false`
    // member, which is the money leg's `Dr accounts_receivable`.
    const contactId = planned.contactId
    const unsettled = amounts.totalMinor - amounts.settlementMinor
    receivableByContact.set(contactId, (receivableByContact.get(contactId) ?? 0) + unsettled)

    sources.push({
      creditMemoId: planned.creditMemoId,
      number: planned.number,
      amounts,
    })
  }

  // ── The lines, in the order §3 sketches them ─────────────────────────────
  const summarised = { sourceType: CREDIT_MEMO_BATCH_SOURCE_TYPE, sourceId: periodKey }
  const describe = (what: string): string =>
    memo ? `${memo} - ${what}` : `${group.groupKey} - ${what}`
  const lines: GlPostingLineInput[] = []
  const push = (line: Omit<GlPostingLineInput, 'sortOrder'>): void => {
    lines.push({ ...line, sortOrder: lines.length } as GlPostingLineInput)
  }

  // 1. Contra-revenue, summarised. Always 4090 and never the original revenue
  //    account: a reversal netted into 4000 leaves a return rate nobody can see.
  if (subtotalMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES,
      direction: 'debit',
      amount: subtotalMinor,
      memo: describe('returns and allowances'),
    })
  }

  // 2. Sales tax, summarised. Transcribed from the memos, never recomputed.
  if (taxTotalMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'debit',
      amount: taxTotalMinor,
      memo: describe('sales tax'),
    })
  }

  // 3. The card rail, summarised.
  if (clearingCardMinor !== 0) {
    push({
      ...summarised,
      accountRole: ACCOUNT_ROLES.CLEARING_CARD,
      direction: 'credit',
      amount: clearingCardMinor,
      memo: describe('card clearing'),
    })
  }

  // 4. Every other rail, PER ACCOUNT ID. See §3.1 item 1.
  for (const [glAccountId, amount] of settlementByAccount) {
    if (amount === 0) continue
    push({
      ...summarised,
      glAccountId,
      direction: 'credit',
      amount,
      memo: describe('gateway clearing'),
    })
  }

  // 5. The receivable, ONE LINE PER CONTACT. Usually zero lines for an
  //    all-channel group, because the money already went back.
  for (const [contactId, amountMinor] of receivableByContact) {
    if (amountMinor === 0) continue
    push({
      ...(contactId
        ? {
            sourceType: CREDIT_MEMO_CONTACT_SOURCE_TYPE,
            sourceId: contactId,
            counterpartyType: 'customer' as const,
            counterpartyId: contactId,
          }
        : summarised),
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: amountMinor > 0 ? 'credit' : 'debit',
      amount: Math.abs(amountMinor),
      memo: describe(contactId ? 'receivable' : 'receivable, no contact'),
    })
  }

  const built = buildEntry({
    postingType: CREDIT_MEMO_POSTING_TYPE,
    periodKey,
    txnDate: group.txnDate,
    lines,
  })

  return {
    // The frozen slice rides into `GlPosting.draft` with the entry - see
    // `BuiltEntry.sources` and `buildPostingDraft`.
    entry: { ...built, sources },
    periodKey,
    totals: {
      subtotalMinor,
      taxTotalMinor,
      totalMinor,
      settlementMinor,
      receivableMinor: totalMinor - settlementMinor,
    },
  }
}

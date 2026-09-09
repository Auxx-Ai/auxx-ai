// packages/lib/src/postings/build-credit-memo-entry.ts

/**
 * The credit memo issue entry: "you owe us less", whoever started it.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   revenue leg (reverseRevenue):
 *     Dr revenue_returns_allowances   subtotal
 *     Dr sales_tax_payable            taxTotal        (omitted when zero)
 *         Cr accounts_receivable        total
 *
 *   money leg (settlement, a channel refund already paid out):
 *     Dr accounts_receivable          amount
 *         Cr clearing_card              amount
 * ```
 *
 * ## One builder, both sources
 *
 * A native memo is a person conceding part of an invoice: the revenue leg and
 * nothing else, because the money, if any moves, is a `PaymentTransaction` of
 * `kind: 'refund'` and posts through `build-payment-entry.ts`'s refund branch.
 * A channel memo is a Shopify refund that was created and paid back in the same
 * instant, and Shopify money never passes through `PaymentTransaction`, so its
 * money leg rides in this entry as the mirror of the channel receipt:
 * `Cr clearing_card`, which `build-payout-entry.ts` then drains net of refunds.
 *
 * ## 4090 always, never the original revenue account
 *
 * A reversal netted into `4000` leaves a return rate nobody can see, which is
 * the reason `revenue_returns_allowances` exists in the default chart at all.
 * The role covers allowances as well as returns, and the allowance is the
 * common case.
 *
 * ## The pre-fulfillment branch
 *
 * A channel memo whose order was never fulfilled before `issuedAt` reverses
 * revenue that was never posted, so the caller passes `reverseRevenue: false`
 * and only the money leg remains. A native memo always reverses revenue,
 * because it exists only where an invoice was issued. A channel memo with
 * neither is refused, naming why: there is no entry to build.
 *
 * ## Tax is transcribed, never recomputed
 *
 * `taxTotal` is the sum of the memo's line tax totals as the lines carry them.
 * Recomputing it from a rate here would be a second implementation free to
 * drift from the document, and an entry that does not tie to its document is
 * worse than no entry. `total` must equal `subtotal + taxTotal` for the same
 * reason: the entry ties to the stored totals by construction or it refuses.
 *
 * @see plans/accounting/tasks/10-credit-memos.md section 3 and section 10.6
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { toAmountMinor } from './build-fulfillment-entry'
import { assertCompactablePeriodKey } from './period-key'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * The `sourceType` every credit memo line carries: the `credit_memo` record.
 *
 * Its own value, deliberately not `invoice`. A memo may have no invoice at all
 * (a channel memo links to an order), and `listPostingsForSource` on the memo
 * id is what a void reads to find the entry it reverses.
 */
export const CREDIT_MEMO_SOURCE_TYPE = 'credit_memo'

/** The posting type an issue entry claims. Prefix `CRM`. */
export const CREDIT_MEMO_POSTING_TYPE = 'credit_memo' as const

/**
 * The money leg of a channel memo.
 *
 * `role` is a discriminator with one member today: `clearing_card` is the ONE
 * clearing role, the account the channel receipt debited gross at the sale and
 * the payout entry drains. When a second clearing role lands, this grows a
 * member rather than the builder growing a parameter.
 */
export interface CreditMemoSettlement {
  role: 'clearing_card'
  /** Integer minor units, > 0 and at most `total`. What the channel paid back. */
  amount: number
}

export interface BuildCreditMemoEntryInput {
  /** The `credit_memo` EntityInstance id. Becomes every line's `sourceId`. */
  creditMemoId: string
  /**
   * The memo's own number (`'CM-0007'`). `periodKey` keys on this, compacted,
   * exactly as `invoice_issued` keys on the invoice number: never a cuid, which
   * is 24 characters on its own, and never a date, because many memos can be
   * issued in one day.
   *
   * One entry per memo falls out of the claim's unique index for free: a second
   * issue of the same memo claims the same
   * `(org, credit_memo, periodKey, revision=0)` tuple and converges to
   * `already_posted`. A memo number is unique in the org by construction, so no
   * owner check is needed on top of it.
   */
  number: string
  /** `YYYY-MM-DD`. The memo's own `issuedAt`. The ledger dates from this. */
  issuedAt: string
  /**
   * The memo's currency. When `ledgerCurrency` is also given and differs, the
   * entry refuses rather than posting at an implied 1.0 rate, the same rule the
   * payment builder applies. Carried for the caller's own assertions otherwise.
   */
  currency: string
  /** The one currency the books are kept in. Omit to skip the currency check. */
  ledgerCurrency?: string
  /** `credit_memo_subtotal`, integer minor units, >= 0. Drives the 4090 leg. */
  subtotal: number | null | undefined
  /** `credit_memo_tax_total`, integer minor units, >= 0. Null is no tax leg. */
  taxTotal: number | null | undefined
  /** `credit_memo_total`, integer minor units, > 0. `subtotal + taxTotal`, asserted. */
  total: number | null | undefined
  /**
   * Whether revenue was ever posted for what this memo credits.
   *
   * Native: always `true`. Channel: `false` when the order had no fulfillment
   * before `issuedAt`, because `build-fulfillment-entry.ts` never recognised
   * the revenue and there is nothing to reverse.
   */
  reverseRevenue: boolean
  /** The channel money leg. Absent for a native memo. */
  settlement?: CreditMemoSettlement
  memo?: string
}

export interface BuiltCreditMemoEntry {
  entry: BuiltEntry
  periodKey: string
  /** The receivable relieved by the revenue leg. Zero when `reverseRevenue` is false. */
  totalMinor: number
  /** What went to `revenue_returns_allowances`. Zero when `reverseRevenue` is false. */
  subtotalMinor: number
  /** What came back out of `sales_tax_payable`. `0` omits the leg. */
  taxTotalMinor: number
  /** What the money leg moved out of `clearing_card`. Zero without a settlement. */
  settlementMinor: number
}

/**
 * Build the issue entry for one credit memo.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long memo number, a
 *   currency that differs from the ledger's, a subtotal, tax or total that is
 *   negative or not whole minor units, a total that is zero or that does not
 *   equal `subtotal + taxTotal`, a settlement amount that is not a positive
 *   whole number of minor units or exceeds the total, or a memo with neither a
 *   revenue leg nor a settlement, which has no entry to build.
 */
export function buildCreditMemoEntry(input: BuildCreditMemoEntryInput): BuiltCreditMemoEntry {
  const { creditMemoId, issuedAt, reverseRevenue, settlement, memo } = input

  const number = assertCompactablePeriodKey({
    value: input.number,
    label: 'Credit memo number',
    remedy:
      'Shorten the credit memo number, or reduce the receivable with a manual journal entry instead.',
    context: { creditMemoId },
  })

  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} is in ${currency} and the ledger is kept in ${input.ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { creditMemoId, number, currency: String(currency), ledgerCurrency: input.ledgerCurrency }
    )
  }

  // `FieldValue.valueNumber` is a `doublePrecision` column, so `12000` can read
  // back as `11999.999999999998`. `toAmountMinor` rounds the double's own noise
  // floor and refuses a genuinely fractional value.
  const subtotalMinor = toAmountMinor(input.subtotal, `Credit memo ${number} subtotal`)
  const taxTotalMinor = toAmountMinor(input.taxTotal, `Credit memo ${number} tax`)
  const totalMinor = toAmountMinor(input.total, `Credit memo ${number} total`)

  const context = {
    creditMemoId,
    number,
    subtotalMinor: String(subtotalMinor),
    taxTotalMinor: String(taxTotalMinor),
    totalMinor: String(totalMinor),
  }

  if (subtotalMinor < 0 || taxTotalMinor < 0) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} carries a subtotal of ${subtotalMinor} and tax of ${taxTotalMinor}. ` +
        'Neither is ever negative - sign lives in the line direction, not in the amount.',
      context
    )
  }
  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} totals ${totalMinor}. An issue entry reduces a receivable by a ` +
        'positive whole number of minor units - a memo that credits nothing has nothing to post.',
      context
    )
  }
  if (totalMinor !== subtotalMinor + taxTotalMinor) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} totals ${totalMinor} but its subtotal ${subtotalMinor} plus tax ` +
        `${taxTotalMinor} is ${subtotalMinor + taxTotalMinor}. The entry ties to the stored totals ` +
        'or it does not post: the totals hook re-sums the lines, so a mismatch is a stale total.',
      context
    )
  }

  const settlementMinor = settlement?.amount ?? 0
  if (settlement) {
    if (
      !Number.isFinite(settlementMinor) ||
      !Number.isInteger(settlementMinor) ||
      settlementMinor <= 0
    ) {
      throw new UnprocessableEntityError(
        `Credit memo ${number} says ${String(settlementMinor)} was refunded at the channel. A ` +
          'settlement is a positive whole number of minor units - a refund of nothing is no ' +
          'settlement, and the sign lives in the line direction.',
        { ...context, settlementMinor: String(settlementMinor) }
      )
    }
    if (settlementMinor > totalMinor) {
      throw new UnprocessableEntityError(
        `Credit memo ${number} says ${settlementMinor} was refunded against a credit of ` +
          `${totalMinor}. The channel cannot have paid back more than the memo credits.`,
        { ...context, settlementMinor: String(settlementMinor) }
      )
    }
  }

  if (!reverseRevenue && !settlement) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} reverses no revenue and carries no settlement, so there is no entry ` +
        'to build. A channel memo on an unfulfilled order posts only its money leg; a native memo ' +
        'always reverses revenue.',
      context
    )
  }

  const lineMemo = memo ?? `Credit memo ${number}`
  const source = { sourceType: CREDIT_MEMO_SOURCE_TYPE, sourceId: creditMemoId }
  const lines: GlPostingLineInput[] = []

  // A zero leg is omitted rather than posted: `buildEntry` refuses a line that
  // moves nothing. A memo that is all tax therefore reverses only the tax; a
  // memo with no tax reverses only revenue.
  if (reverseRevenue) {
    if (subtotalMinor > 0) {
      lines.push({
        ...source,
        accountRole: ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES,
        direction: 'debit',
        amount: subtotalMinor,
        memo: lineMemo,
        sortOrder: lines.length,
      })
    }
    if (taxTotalMinor > 0) {
      lines.push({
        ...source,
        accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
        direction: 'debit',
        amount: taxTotalMinor,
        memo: `${lineMemo} sales tax`,
        sortOrder: lines.length,
      })
    }
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'credit',
      amount: totalMinor,
      memo: lineMemo,
      sortOrder: lines.length,
    })
  }

  if (settlement) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: settlementMinor,
      memo: `${lineMemo} refunded`,
      sortOrder: lines.length,
    })
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.CLEARING_CARD,
      direction: 'credit',
      amount: settlementMinor,
      memo: `${lineMemo} refunded`,
      sortOrder: lines.length,
    })
  }

  return {
    entry: buildEntry({
      postingType: CREDIT_MEMO_POSTING_TYPE,
      periodKey: number,
      txnDate: issuedAt,
      lines,
    }),
    periodKey: number,
    totalMinor: reverseRevenue ? totalMinor : 0,
    subtotalMinor: reverseRevenue ? subtotalMinor : 0,
    taxTotalMinor: reverseRevenue ? taxTotalMinor : 0,
    settlementMinor,
  }
}

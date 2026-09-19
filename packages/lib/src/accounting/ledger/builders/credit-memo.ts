// packages/lib/src/accounting/ledger/builders/credit-memo.ts

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
 *   pre-fulfillment (reverseRevenue false):
 *     Dr customer_deposits            total
 *         Cr accounts_receivable        total
 * ```
 *
 * ## One builder, both sources
 *
 * A native memo is a person conceding part of an invoice: the revenue leg and
 * nothing else. A channel memo is the same entry when the order shipped first.
 *
 * 🛑 **No money leg, either way** (71 D6). The refund is its own `refund` entry
 * off its own `MoneyTransaction`, `Dr <this memo's control account> / Cr <the
 * cash endpoint>`, so one memo refunded on two rails stays two credits and this
 * entry never has to know which rail paid.
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
 * and the entry moves the customer's ADVANCE instead: the pre-fulfillment
 * receipt credited the whole amount, tax included, to `customer_deposits`
 * (`customer-money/accounting.ts`), so the memo debits that liability in full
 * and credits the control account the refund later draws down (71 D14). No
 * `sales_tax_payable` line: none was ever credited. A native memo always reverses revenue,
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
 * @see plans/accounting/tasks/done/10-credit-memos.md section 3 and section 10.6
 */

import { UnprocessableEntityError } from '../../../errors'
import { assertCompactablePeriodKey } from '../periods/period-key'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { ACCOUNT_ROLES, buildEntry } from './entry'
import { toAmountMinor } from './fulfillment'

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

/** One explicit entitlement component. Cash refunds are separate effects. */
export interface CreditMemoEntitlementComponent {
  componentKey: 'earned_revenue' | 'customer_deposit' | 'sales_tax'
  accountRole: 'revenue_returns_allowances' | 'customer_deposits' | 'sales_tax_payable'
  direction: 'debit'
  amount: number
}

export interface BuildCreditMemoEntitlementEntryInput {
  creditMemoId: string
  number: string
  issuedAt: string
  currency: string
  ledgerCurrency?: string
  total: number
  components: CreditMemoEntitlementComponent[]
  creditControlGlAccountId: string
  contactInstanceId?: string | null
  memo?: string
}

export interface BuiltCreditMemoEntitlementEntry {
  entry: BuiltEntry
  periodKey: string
  totalMinor: number
}

/** The amounts one memo contributes, all integer minor units. */
export interface CreditMemoAmounts {
  /** Zero when `reverseRevenue` is false: there is no revenue leg to split. */
  subtotalMinor: number
  /** Zero when `reverseRevenue` is false. */
  taxTotalMinor: number
  /** The memo total, `reverseRevenue` or not — the control credit is always for it. */
  totalMinor: number
  reverseRevenue: boolean
}

/** What one memo's arithmetic needs, and nothing else. See {@link computeCreditMemoAmounts}. */
export interface CreditMemoAmountsInput {
  /** The `credit_memo` EntityInstance id. Rides on every refusal's context. */
  creditMemoId: string
  /** The memo's own number (`'CM-0007'`). Names every refusal. */
  number: string
  /** `credit_memo_subtotal`, integer minor units, >= 0. */
  subtotal: number | null | undefined
  /** `credit_memo_tax_total`, integer minor units, >= 0. */
  taxTotal: number | null | undefined
  /** `credit_memo_total`, integer minor units, > 0. `subtotal + taxTotal`, asserted. */
  total: number | null | undefined
  /** Whether revenue was ever posted for what this memo credits. */
  reverseRevenue: boolean
}

/**
 * One memo's amounts, validated and zeroed where it reverses no revenue.
 *
 * PURE, and **the single implementation of the per-memo arithmetic**. Three
 * callers share it - this file's single-memo entry, the batch planner, and
 * `build-credit-memo-batch-entry.ts` through the amounts the planner froze -
 * so a batched January and the same memo posted on its own can never disagree
 * about what it credits. Two copies of this would be two rounding rules and
 * two refusal ladders, free to drift, and a drifted one is undetectable: both
 * entries balance.
 *
 * `reverseRevenue: false` zeroes the two revenue numbers rather than dropping
 * the memo: its entry moves the customer's advance instead (71 D14), and the
 * total is what that entry is for.
 *
 * @throws {UnprocessableEntityError} on a subtotal, tax or total that is
 *   negative or not whole minor units, or a total that is zero or that does not
 *   equal `subtotal + taxTotal`.
 */
export function computeCreditMemoAmounts(input: CreditMemoAmountsInput): CreditMemoAmounts {
  const { creditMemoId, number, reverseRevenue } = input

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

  return {
    subtotalMinor: reverseRevenue ? subtotalMinor : 0,
    taxTotalMinor: reverseRevenue ? taxTotalMinor : 0,
    totalMinor,
    reverseRevenue,
  }
}

/**
 * Build only the credit entitlement entry. A provider refund or channel clearing leg must never
 * be folded into this entry: those facts belong to a separate customer-refund effect.
 */
export function buildCreditMemoEntitlementEntry(
  input: BuildCreditMemoEntitlementEntryInput
): BuiltCreditMemoEntitlementEntry {
  const number = assertCompactablePeriodKey({
    value: input.number,
    label: 'Credit memo number',
    remedy: 'Shorten the credit memo number before posting the entitlement.',
    context: { creditMemoId: input.creditMemoId },
  })
  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency)
    throw new UnprocessableEntityError(
      `Credit memo ${number} is in ${currency} and the ledger is kept in ${input.ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { creditMemoId: input.creditMemoId, number, currency: String(currency) }
    )
  if (!input.creditControlGlAccountId.trim())
    throw new UnprocessableEntityError('A credit entitlement needs a resolved control account', {
      creditMemoId: input.creditMemoId,
    })
  if (!Number.isSafeInteger(input.total) || input.total <= 0)
    throw new UnprocessableEntityError(
      'A credit entitlement total must be a positive safe integer',
      {
        creditMemoId: input.creditMemoId,
      }
    )
  if (input.components.length === 0)
    throw new UnprocessableEntityError('A credit entitlement needs at least one component', {
      creditMemoId: input.creditMemoId,
    })
  const keys = new Set<string>()
  let debit = 0
  const lines: GlPostingLineInput[] = []
  const source = { sourceType: CREDIT_MEMO_SOURCE_TYPE, sourceId: input.creditMemoId }
  const counterparty = input.contactInstanceId
    ? { counterpartyType: 'customer' as const, counterpartyId: input.contactInstanceId }
    : {}
  for (const component of input.components) {
    if (keys.has(component.componentKey))
      throw new UnprocessableEntityError('Credit entitlement component keys must be unique', {
        creditMemoId: input.creditMemoId,
      })
    keys.add(component.componentKey)
    if (!Number.isSafeInteger(component.amount) || component.amount <= 0)
      throw new UnprocessableEntityError(
        'Credit entitlement components must be positive integers',
        {
          creditMemoId: input.creditMemoId,
        }
      )
    lines.push({
      ...source,
      accountRole: component.accountRole,
      direction: component.direction,
      amount: component.amount,
      memo: input.memo ?? `Credit memo ${number}`,
      sortOrder: lines.length,
    })
    debit += component.amount
  }
  if (debit !== input.total)
    throw new UnprocessableEntityError(
      'Credit entitlement components must total the memo and leave a control balance',
      { creditMemoId: input.creditMemoId, debit: String(debit) }
    )
  const controlAmount = debit
  lines.push({
    ...source,
    glAccountId: input.creditControlGlAccountId,
    direction: 'credit',
    amount: controlAmount,
    memo: `${input.memo ?? `Credit memo ${number}`} control`,
    sortOrder: lines.length,
    ...counterparty,
  })
  return {
    entry: buildEntry({
      postingType: CREDIT_MEMO_POSTING_TYPE,
      periodKey: number,
      txnDate: input.issuedAt,
      lines,
    }),
    periodKey: number,
    totalMinor: input.total,
  }
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
  /**
   * The claim and document-number key, when it is NOT the memo number.
   *
   * A repost after an edit passes one: the reversed original's claim row is
   * gone but its document number is still in the books, and re-keying on
   * `number` would mint that same number again. See
   * `accounting/documents/document-entry-key.ts`.
   */
  periodKey?: string | null
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
  /**
   * The memo's own contact (`credit_memo_contact`), for the counterparty on
   * every `accounts_receivable` line this entry carries (brief 13 §1.2) - never
   * on the revenue, tax or clearing legs. Null or absent still posts.
   */
  contactInstanceId?: string | null
  memo?: string
}

export interface BuiltCreditMemoEntry {
  entry: BuiltEntry
  periodKey: string
  /** The receivable this entry credits — the memo total, either branch. */
  totalMinor: number
  /** What went to `revenue_returns_allowances`. Zero when `reverseRevenue` is false. */
  subtotalMinor: number
  /** What came back out of `sales_tax_payable`. `0` omits the leg. */
  taxTotalMinor: number
}

/**
 * Build the issue entry for one credit memo.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long memo number, a
 *   currency that differs from the ledger's, a subtotal, tax or total that is
 *   negative or not whole minor units, or a total that is zero or that does not
 *   equal `subtotal + taxTotal`.
 */
export function buildCreditMemoEntry(input: BuildCreditMemoEntryInput): BuiltCreditMemoEntry {
  const { creditMemoId, issuedAt, reverseRevenue, memo, contactInstanceId } = input

  const number = assertCompactablePeriodKey({
    value: input.number,
    label: 'Credit memo number',
    remedy:
      'Shorten the credit memo number, or reduce the receivable with a manual journal entry instead.',
    context: { creditMemoId },
  })

  const periodKey = input.periodKey?.trim()
    ? assertCompactablePeriodKey({
        value: input.periodKey,
        label: 'Credit memo entry key',
        remedy: 'Shorten the credit memo number before re-posting it.',
        context: { creditMemoId },
      })
    : number

  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Credit memo ${number} is in ${currency} and the ledger is kept in ${input.ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { creditMemoId, number, currency: String(currency), ledgerCurrency: input.ledgerCurrency }
    )
  }

  // The arithmetic and every refusal in it belong to `computeCreditMemoAmounts`,
  // which the batch planner also calls: one implementation, so a batched memo
  // and the same memo posted alone can never disagree about what it credits.
  // The three revenue numbers come back zeroed when `reverseRevenue` is false,
  // which is exactly what the revenue leg below is skipped for.
  const { subtotalMinor, taxTotalMinor, totalMinor } = computeCreditMemoAmounts({
    creditMemoId,
    number,
    subtotal: input.subtotal,
    taxTotal: input.taxTotal,
    total: input.total,
    reverseRevenue,
  })

  const lineMemo = memo ?? `Credit memo ${number}`
  const source = { sourceType: CREDIT_MEMO_SOURCE_TYPE, sourceId: creditMemoId }
  const lines: GlPostingLineInput[] = []
  // Every `accounts_receivable` leg carries it - never revenue, tax or clearing.
  const counterparty = contactInstanceId
    ? { counterpartyType: 'customer' as const, counterpartyId: contactInstanceId }
    : {}

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
      ...counterparty,
    })
  } else {
    // 71 D14. Nothing was recognised, so there is no revenue to reverse and no
    // tax to give back: the pre-fulfillment receipt credited the whole amount to
    // `customer_deposits`. The memo moves that advance onto the control account
    // the refund then draws down, so `readCreditMemoControlAccount` finds a live
    // posting and the refund poster stays the one shape for every memo.
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
      direction: 'debit',
      amount: totalMinor,
      memo: `${lineMemo} against the customer's advance`,
      sortOrder: lines.length,
    })
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'credit',
      amount: totalMinor,
      memo: lineMemo,
      sortOrder: lines.length,
      ...counterparty,
    })
  }

  return {
    entry: buildEntry({
      postingType: CREDIT_MEMO_POSTING_TYPE,
      periodKey,
      txnDate: issuedAt,
      lines,
    }),
    periodKey,
    totalMinor,
    subtotalMinor,
    taxTotalMinor,
  }
}

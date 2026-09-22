// packages/lib/src/accounting/ledger/builders/credit-memo.ts

/**
 * The credit memo issue entry, per line (91 D4). PURE: no database, no clock, no chart.
 *
 * ```
 *   Dr revenue_returns_allowances   the shipped goods lines' subtotal
 *   Dr revenue_shipping             the shipped shipping lines' subtotal (91 D8)
 *   Dr sales_tax_payable            the shipped lines' tax      (omitted when zero)
 *       Cr accounts_receivable        the three together
 * ```
 *
 * A line whose goods had not shipped posts nothing: no revenue was recognised, and
 * its money is already a credit in A/R that the refund debits. No money leg (71 D6).
 * Tax is transcribed from the lines, never recomputed from a rate.
 *
 * @see plans/accounting/tasks/91-one-entry-per-event.md §4.4
 */

import { UnprocessableEntityError } from '../../../errors'
import { assertDocumentKey } from '../periods/period-key'
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
  componentKey: 'earned_revenue' | 'shipping' | 'sales_tax'
  accountRole: 'revenue_returns_allowances' | 'revenue_shipping' | 'sales_tax_payable'
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

/** One memo line as the entry sees it. */
export interface CreditMemoEntryLine {
  /** `credit_memo_line_subtotal`, integer minor units, >= 0. */
  subtotal: number | null | undefined
  /** `credit_memo_line_tax_total`, integer minor units, >= 0. Null is no tax. */
  taxTotal: number | null | undefined
  /** The line's goods had shipped before the memo, so there is revenue to reverse. */
  shipped: boolean
  /** `shipping` gives back shipping charged, reversing `revenue_shipping`. Absent is goods. */
  component?: 'goods' | 'shipping'
}

/** The amounts one memo posts, all integer minor units: its shipped lines only. */
export interface CreditMemoAmounts {
  /** The shipped goods lines, to `revenue_returns_allowances`. */
  subtotalMinor: number
  /** The shipped shipping lines, to `revenue_shipping`. */
  shippingMinor: number
  taxTotalMinor: number
  /** All three together. Zero when no line had shipped. */
  totalMinor: number
}

/** What one memo's arithmetic needs, and nothing else. See {@link computeCreditMemoAmounts}. */
export interface CreditMemoAmountsInput {
  /** The `credit_memo` EntityInstance id. Rides on every refusal's context. */
  creditMemoId: string
  /** The memo's own number (`'CM-0007'`). Names every refusal. */
  number: string
  lines: readonly CreditMemoEntryLine[]
  /** `credit_memo_total`, integer minor units, > 0. The sum of every line, asserted. */
  total: number | null | undefined
}

/**
 * One memo's amounts: every line validated, the document total tied, the shipped
 * lines summed. The single implementation of the per-memo arithmetic.
 *
 * @throws {UnprocessableEntityError} on a line subtotal or tax that is negative or
 *   not whole minor units, or a total that is zero or not the sum of the lines.
 */
export function computeCreditMemoAmounts(input: CreditMemoAmountsInput): CreditMemoAmounts {
  const { creditMemoId, number } = input

  // `FieldValue.valueNumber` is a `doublePrecision` column, so `12000` can read
  // back as `11999.999999999998`; `toAmountMinor` rounds that noise and refuses a real fraction.
  let subtotalMinor = 0
  let taxTotalMinor = 0
  let shippedSubtotalMinor = 0
  let shippedShippingMinor = 0
  let shippedTaxMinor = 0
  input.lines.forEach((line, index) => {
    const subtotal = toAmountMinor(
      line.subtotal,
      `Credit memo ${number} line ${index + 1} subtotal`
    )
    const tax = toAmountMinor(line.taxTotal, `Credit memo ${number} line ${index + 1} tax`)
    if (subtotal < 0 || tax < 0)
      throw new UnprocessableEntityError(
        `Credit memo ${number} line ${index + 1} carries a subtotal of ${subtotal} and tax of ${tax}. ` +
          'Neither is ever negative - sign lives in the line direction, not in the amount.',
        { creditMemoId, number }
      )
    subtotalMinor += subtotal
    taxTotalMinor += tax
    if (line.shipped) {
      if (line.component === 'shipping') shippedShippingMinor += subtotal
      else shippedSubtotalMinor += subtotal
      shippedTaxMinor += tax
    }
  })
  const totalMinor = toAmountMinor(input.total, `Credit memo ${number} total`)

  const context = {
    creditMemoId,
    number,
    subtotalMinor: String(subtotalMinor),
    taxTotalMinor: String(taxTotalMinor),
    totalMinor: String(totalMinor),
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
    subtotalMinor: shippedSubtotalMinor,
    shippingMinor: shippedShippingMinor,
    taxTotalMinor: shippedTaxMinor,
    totalMinor: shippedSubtotalMinor + shippedShippingMinor + shippedTaxMinor,
  }
}

/**
 * Build only the credit entitlement entry. A provider refund or channel clearing leg must never
 * be folded into this entry: those facts belong to a separate customer-refund effect.
 */
export function buildCreditMemoEntitlementEntry(
  input: BuildCreditMemoEntitlementEntryInput
): BuiltCreditMemoEntitlementEntry {
  const number = assertDocumentKey({
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
  lines: readonly CreditMemoEntryLine[]
  /** `credit_memo_total`, integer minor units, > 0. The sum of every line, asserted. */
  total: number | null | undefined
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
  /** The receivable this entry credits: the shipped lines, tax included. */
  totalMinor: number
  /** What went to `revenue_returns_allowances`. */
  subtotalMinor: number
  /** What went to `revenue_shipping`. `0` omits the leg. */
  shippingMinor: number
  /** What came back out of `sales_tax_payable`. `0` omits the leg. */
  taxTotalMinor: number
}

/**
 * Build the issue entry for one credit memo.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long memo number, a
 *   currency that differs from the ledger's, any refusal of
 *   {@link computeCreditMemoAmounts}, or a memo with no shipped line (nothing to post).
 */
export function buildCreditMemoEntry(input: BuildCreditMemoEntryInput): BuiltCreditMemoEntry {
  const { creditMemoId, issuedAt, memo, contactInstanceId } = input

  const number = assertDocumentKey({
    value: input.number,
    label: 'Credit memo number',
    remedy:
      'Shorten the credit memo number, or reduce the receivable with a manual journal entry instead.',
    context: { creditMemoId },
  })

  const periodKey = input.periodKey?.trim()
    ? assertDocumentKey({
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

  const { subtotalMinor, shippingMinor, taxTotalMinor, totalMinor } = computeCreditMemoAmounts({
    creditMemoId,
    number,
    lines: input.lines,
    total: input.total,
  })
  if (totalMinor === 0)
    throw new UnprocessableEntityError(
      `Credit memo ${number} credits no line that had shipped, so it has no revenue to reverse.`,
      { creditMemoId, number }
    )

  const lineMemo = memo ?? `Credit memo ${number}`
  const source = { sourceType: CREDIT_MEMO_SOURCE_TYPE, sourceId: creditMemoId }
  const lines: GlPostingLineInput[] = []
  // Every `accounts_receivable` leg carries it - never revenue, tax or clearing.
  const counterparty = contactInstanceId
    ? { counterpartyType: 'customer' as const, counterpartyId: contactInstanceId }
    : {}

  // A zero leg is omitted: `buildEntry` refuses a line that moves nothing.
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
  if (shippingMinor > 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.REVENUE_SHIPPING,
      direction: 'debit',
      amount: shippingMinor,
      memo: `${lineMemo} shipping`,
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
    shippingMinor,
    taxTotalMinor,
  }
}

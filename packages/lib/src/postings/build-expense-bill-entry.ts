// packages/lib/src/postings/build-expense-bill-entry.ts

/**
 * The standalone company's A/P bill: rent, insurance, a legal invoice, a
 * software subscription.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr <the account each line is coded to>   line total
 *       Cr accounts_payable                    bill total
 * ```
 *
 * ## 🛑 Why this is not `buildVendorBillEntry`
 *
 * `buildVendorBillEntry` emits `Dr GRNI / Dr-or-Cr PPV / Cr accounts_payable`.
 * That is the L3 PURCHASING story: it relieves goods-received-not-invoiced
 * against what the three-way match accrued on the dock, and there is no
 * expense-coded line in it anywhere. A rent bill has no receipt, no GRNI
 * accrual and no purchase order, so the two are different accounting stories
 * and they get different builders and different posting types
 * (`plans/accounting/tasks/21-the-books-stand-alone.md` §3.2, MK's decision C
 * at §10.3). Two stories in one builder is how both become wrong.
 *
 * It follows that this ships with the L3 switch untouched: `expense_bill` is
 * absent from `ENABLED_POSTING_TYPES` and
 * `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.expense_bill` is `[]`, so an
 * expense-coded bill drives no single-writer role and cannot conflict with
 * `month_end_inventory`.
 *
 * ## The debit is named by ID, the credit by ROLE
 *
 * The expense account is the BOOKKEEPER's own pick out of THEIR chart -
 * `vendor_bill_line.glAccount` has held a `gl_account` id since entity
 * migration 143 - and most of a chart carries no auxx role at all. So the debit
 * legs carry `{ glAccountId }`, exactly as a coded bank line and a reversal do,
 * and `resolveAccountLines` validates each id against the org's chart with the
 * same batched refusals it applies to a role.
 *
 * `accounts_payable` is the other way round: it fulfils an accounting FUNCTION,
 * one account does it, and `G8` protects it from a renumber. So it stays a
 * role.
 *
 * ⚠️ `GlPostingLineInput` is a three-way union and `buildEntry` REFUSES a line
 * that names more than one of role / code / id. Nothing here may carry both.
 *
 * ## The entry ties to the bill's stored total, or it refuses
 *
 * A bill's header totals are TRANSCRIBED from the vendor's paper and never
 * recomputed (`docs/inventory-costing-architecture-guide.md` §9), so the credit
 * is `vendor_bill_total` verbatim. When the coded lines do not sum to it - the
 * ordinary cause is header tax or freight, which carry no account of their own
 * - this refuses and names the difference. It does NOT plug the gap: a plug
 * would be a guess about which account the tax belongs in, and a wrong guess
 * balances perfectly and is invisible until somebody reads the P&L.
 *
 * @see plans/accounting/tasks/21-the-books-stand-alone.md §3.2, §3.3
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { toAmountMinor } from './build-fulfillment-entry'
import { assertCompactablePeriodKey } from './period-key'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * The `sourceType` every expense-bill line carries: the `vendor_bill` record.
 *
 * 🛑 **`'vendor_bill'`, deliberately NOT `'expense_bill'`.** The record IS a
 * `vendor_bill` EntityInstance - there is no separate expense-bill entity - and
 * `reports/aging.ts` already resolves a payable line whose `sourceType` is
 * `vendor_bill` through `vendor_bill_number`, `vendor_bill_due_at`,
 * `vendor_bill_vendor` and `vendor_bill_status`, giving the A/P aging its
 * label, its due-date bucket, its vendor group, its badge and its drawer link
 * with no change to that file at all. A private source type would land every
 * expense bill in "Unapplied and adjustments" with no due date and no vendor,
 * which is the report reading worse for a distinction only the POSTING TYPE
 * needs to make.
 *
 * `invoice_issued` and `write_off` share `'invoice'` for the same reason.
 */
export const EXPENSE_BILL_SOURCE_TYPE = 'vendor_bill'

/** The posting type an expense bill claims. Prefix `EXB`; `BIL` is `vendor_bill`'s. */
export const EXPENSE_BILL_POSTING_TYPE = 'expense_bill' as const

/** One coded line of the bill, as it is transcribed on the record. */
export interface ExpenseBillLineInput {
  /** The `vendor_bill_line` EntityInstance id. Named in a refusal. */
  lineId: string
  /**
   * The `gl_account` instance id off `vendor_bill_line_gl_account`.
   *
   * Missing is a REFUSAL naming the line, never a fallback account: a bill
   * silently coded to "miscellaneous" is a bill nobody ever recodes.
   */
  glAccountId: string | null | undefined
  /**
   * `vendor_bill_line_line_total`, integer minor units. Signed: a negative line
   * (a discount, a credit the vendor put on the same document) posts as a
   * CREDIT to the same account, the way the vendor bill's PPV residual does.
   * Zero is dropped - `buildEntry` refuses a line that moves nothing.
   */
  amount: number | null | undefined
  /** `vendor_bill_line_description`, for the line memo and the refusal. */
  description?: string | null
}

export interface BuildExpenseBillEntryInput {
  /** The `vendor_bill` EntityInstance id. Becomes every line's `sourceId`. */
  vendorBillId: string
  /**
   * OUR own reference for the bill (`'BILL-0007'`), off
   * `vendor_bill_internal_number`. `periodKey` keys on this, compacted, exactly
   * as `invoice_issued` and `credit_memo` key on their own record's number, so
   * one entry per bill falls out of the claim's unique index for free and a
   * void reverses it at `-R1`.
   *
   * 🛑 **Never `vendor_bill_number`**, which is the VENDOR's own invoice number.
   * That field's own registry note says two vendors may legitimately use the
   * same string, and two bills sharing a period key would claim one
   * `(org, expense_bill, periodKey, revision=0)` tuple: the loser converges to
   * `already_posted`, a SUCCESS, and its payable is never recorded. The
   * internal number is `RecordSequence`-issued on create and unique in the org
   * by construction, which is the property this key needs and the vendor's
   * number does not have.
   */
  internalNumber: string
  /** `YYYY-MM-DD`. The bill's own `billedAt` - the ACCOUNTING date, never today. */
  billedAt: string
  /**
   * The bill's currency. When `ledgerCurrency` is also given and differs, the
   * entry refuses rather than posting at an implied 1.0 rate - the same rule
   * the payment and credit-memo builders apply.
   */
  currency?: string | null
  /** The one currency the books are kept in. Omit to skip the currency check. */
  ledgerCurrency?: string
  /** `vendor_bill_total`, integer minor units, > 0. Transcribed, never computed. */
  total: number | null | undefined
  /** The bill's coded lines, in display order. At least one must move money. */
  lines: readonly ExpenseBillLineInput[]
  /**
   * The bill's own vendor (`vendor_bill_vendor`), a `company` instance id, for
   * the counterparty on the `accounts_payable` line (brief 13 §1.2) - never on
   * an expense line.
   *
   * 🛑 Required in practice even though the ledger posts without it: the
   * QuickBooks provider REFUSES a line on an `accounts_payable` subtype account
   * that carries no counterparty, so an absent vendor makes the EXPORT fail
   * rather than the post. `vendor_bill_vendor` is `required: true` on the
   * registry, so a bill that reaches here without one is a data defect.
   */
  vendorCompanyInstanceId?: string | null
  memo?: string
}

export interface BuiltExpenseBillEntry {
  entry: BuiltEntry
  /** `internalNumber`, trimmed. The claim key and the document number's key. */
  periodKey: string
  /** The payable raised. Equals the bill's stored total. */
  totalMinor: number
  /** One debit (or credit) leg per coded line that moves money, in bill order. */
  expenseLines: Array<{ lineId: string; glAccountId: string; amountMinor: number }>
}

/**
 * Build the A/P entry for one expense-coded vendor bill.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long internal number, a
 *   currency that differs from the ledger's, a total that is not a positive
 *   whole number of minor units, a line whose amount is not whole minor units,
 *   a line with no `glAccount` coded on it, a bill with no line that moves
 *   money, or coded lines that do not sum to the bill's stored total.
 */
export function buildExpenseBillEntry(input: BuildExpenseBillEntryInput): BuiltExpenseBillEntry {
  const { vendorBillId, billedAt, memo, vendorCompanyInstanceId } = input

  const number = assertCompactablePeriodKey({
    value: input.internalNumber,
    label: 'Bill reference',
    remedy:
      'Shorten the vendor bill sequence prefix, or record the payable with a manual journal ' +
      'entry instead.',
    context: { vendorBillId },
  })

  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Bill ${number} is in ${currency} and the ledger is kept in ${input.ledgerCurrency}. ` +
        'Posting it would use an implied 1.0 rate, so it is refused rather than mis-stated.',
      { vendorBillId, number, currency: String(currency), ledgerCurrency: input.ledgerCurrency }
    )
  }

  // `FieldValue.valueNumber` is a `doublePrecision` column, so `12000` can read
  // back as `11999.999999999998`. `toAmountMinor` rounds the double's own noise
  // floor and refuses a genuinely fractional value.
  const totalMinor = toAmountMinor(input.total, `Bill ${number} total`)
  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} totals ${totalMinor}. An expense bill raises a payable, which is a ` +
        'positive whole number of minor units - a vendor credit is its own document, not a ' +
        'negative bill.',
      { vendorBillId, number, totalMinor: String(totalMinor) }
    )
  }

  // ── Every line, coded, before anything is built ──────────────────────────
  // Batched rather than fail-fast: a bill with four uncoded lines names all
  // four, so the bookkeeper codes them in one pass instead of four.
  const uncoded: string[] = []
  const coded: Array<{ lineId: string; glAccountId: string; amountMinor: number; memo: string }> =
    []
  let codedMinor = 0

  for (const [index, line] of input.lines.entries()) {
    const label = line.description?.trim() || `Line ${index + 1}`
    const amountMinor = toAmountMinor(line.amount, `Bill ${number} ${label}`)
    codedMinor += amountMinor
    // A zero line is dropped rather than refused: a no-charge line on a vendor's
    // document is ordinary, and `buildEntry` refuses a line that moves nothing.
    // It still needs no account, so it is checked AFTER the drop.
    if (amountMinor === 0) continue

    const glAccountId = line.glAccountId?.trim()
    if (!glAccountId) {
      uncoded.push(label)
      continue
    }
    coded.push({
      lineId: line.lineId,
      glAccountId,
      amountMinor,
      memo: line.description?.trim() || `Bill ${number}`,
    })
  }

  if (uncoded.length > 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} has ${uncoded.length === 1 ? 'a line' : `${uncoded.length} lines`} with no ` +
        `GL account: ${uncoded.join(', ')}. Code ${uncoded.length === 1 ? 'it' : 'them'} to an ` +
        'account before posting - there is no default expense account to fall back on, and ' +
        'guessing one puts real money somewhere nobody will ever look.',
      { vendorBillId, number, lines: uncoded.join(', ') }
    )
  }

  if (coded.length === 0) {
    throw new UnprocessableEntityError(
      `Bill ${number} has no line that moves money, so there is no entry to build.`,
      { vendorBillId, number }
    )
  }

  if (codedMinor !== totalMinor) {
    const difference = totalMinor - codedMinor
    throw new UnprocessableEntityError(
      `Bill ${number} totals ${totalMinor} but its coded lines sum to ${codedMinor}, a ` +
        `difference of ${difference}. A bill's total is transcribed from the vendor's document ` +
        'and never recomputed, so the entry ties to it or it does not post. Header tax and ' +
        'freight carry no account of their own: add a line for each and code it, rather than ' +
        'letting the difference land on an account nothing chose.',
      {
        vendorBillId,
        number,
        totalMinor: String(totalMinor),
        codedMinor: String(codedMinor),
        differenceMinor: String(difference),
      }
    )
  }

  const source = { sourceType: EXPENSE_BILL_SOURCE_TYPE, sourceId: vendorBillId }
  const lines: GlPostingLineInput[] = coded.map((line, index) => ({
    ...source,
    // The IDENTITY, never a role and never a code - see the file header. No
    // `accountRole` beside it: `buildEntry` refuses a line that names two.
    glAccountId: line.glAccountId,
    direction: line.amountMinor > 0 ? ('debit' as const) : ('credit' as const),
    amount: Math.abs(line.amountMinor),
    memo: line.memo,
    sortOrder: index,
  }))

  // ONE payable credit for the whole bill, however many lines it was coded
  // across: the payable is what is owed on the DOCUMENT, and the A/P aging nets
  // per document. It is the only line that carries the counterparty.
  lines.push({
    ...source,
    accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
    direction: 'credit',
    amount: totalMinor,
    memo: memo ?? `Bill ${number}`,
    sortOrder: lines.length,
    ...(vendorCompanyInstanceId
      ? { counterpartyType: 'vendor' as const, counterpartyId: vendorCompanyInstanceId }
      : {}),
  })

  return {
    entry: buildEntry({
      postingType: EXPENSE_BILL_POSTING_TYPE,
      periodKey: number,
      txnDate: billedAt,
      lines,
    }),
    periodKey: number,
    totalMinor,
    expenseLines: coded.map((line) => ({
      lineId: line.lineId,
      glAccountId: line.glAccountId,
      amountMinor: line.amountMinor,
    })),
  }
}

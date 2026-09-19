// packages/lib/src/accounting/ledger/builders/vendor-credit.ts

/**
 * The supplier's credit note: `buildVendorBillEntry`'s coded lines with the sides flipped.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr accounts_payable                      credit total
 *       Cr <the account each line is coded to>  line total
 * ```
 *
 * One builder, whatever the credit is for. A short shipment on a PO-backed bill
 * is this entry with the org's `grni` account on the line — resolved through
 * `resolveRoles` by the writer and prefilled onto the line, never a per-line
 * role here (71 U7, decision 1).
 *
 * @see plans/accounting/tasks/71-one-cash-endpoint.md §5 U7
 */

import { UnprocessableEntityError } from '../../../errors'
import { assertCompactablePeriodKey } from '../periods/period-key'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { ACCOUNT_ROLES, buildEntry } from './entry'
import { toAmountMinor } from './fulfillment'

/** The `sourceType` every vendor-credit line carries: the `vendor_credit` record. */
export const VENDOR_CREDIT_SOURCE_TYPE = 'vendor_credit'

/** The posting type a vendor credit claims. Prefix `VCR`. */
export const VENDOR_CREDIT_POSTING_TYPE = 'vendor_credit' as const

/** One coded line of the credit. */
export interface VendorCreditLineInput {
  /** The `vendor_credit_line` EntityInstance id. Named in a refusal. */
  lineId: string
  /**
   * The `gl_account` instance id off `vendor_credit_line_gl_account`.
   *
   * Missing is a REFUSAL naming the line, never a fallback account.
   */
  glAccountId: string | null | undefined
  /** `vendor_credit_line_line_total`, integer minor units. Signed. */
  amount: number | null | undefined
  /** `vendor_credit_line_description`, for the line memo and the refusal. */
  description?: string | null
}

export interface BuildVendorCreditEntryInput {
  /** The `vendor_credit` EntityInstance id. Becomes every line's `sourceId`. */
  vendorCreditId: string
  /** OUR own number for the credit (`'VC-0001'`). The claim key. */
  number: string
  /** `YYYY-MM-DD`. The credit's own `issuedAt` — the ACCOUNTING date. */
  issuedAt: string
  currency?: string | null
  ledgerCurrency?: string
  /** `vendor_credit_total`, integer minor units, > 0. */
  total: number | null | undefined
  lines: readonly VendorCreditLineInput[]
  /** `vendor_credit_vendor`, a `company` instance id — the A/P counterparty. */
  vendorCompanyInstanceId?: string | null
  memo?: string
}

export interface BuiltVendorCreditEntry {
  entry: BuiltEntry
  /** `number`, trimmed. The claim key and the document number's key. */
  periodKey: string
  /** The payable relieved. Equals the credit's stored total. */
  totalMinor: number
  /** One credit leg per coded line that moves money, in line order. */
  creditLines: Array<{ lineId: string; glAccountId: string; amountMinor: number }>
}

/**
 * Build the A/P entry for one vendor credit.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long number, a currency
 *   that differs from the ledger's, a total that is not a positive whole number
 *   of minor units, a line with no `glAccount` coded on it, a credit with no
 *   line that moves money, or coded lines that do not sum to the stored total.
 */
export function buildVendorCreditEntry(input: BuildVendorCreditEntryInput): BuiltVendorCreditEntry {
  const { vendorCreditId, issuedAt, memo, vendorCompanyInstanceId } = input

  const number = assertCompactablePeriodKey({
    value: input.number,
    label: 'Vendor credit reference',
    remedy: 'Shorten the vendor credit sequence prefix.',
    context: { vendorCreditId },
  })

  const currency = input.currency?.trim() || input.ledgerCurrency
  if (input.ledgerCurrency && currency !== input.ledgerCurrency) {
    throw new UnprocessableEntityError(
      `Vendor credit ${number} is in ${currency} and the ledger is kept in ` +
        `${input.ledgerCurrency}. Posting it would use an implied 1.0 rate, so it is refused ` +
        'rather than mis-stated.',
      { vendorCreditId, number, currency: String(currency), ledgerCurrency: input.ledgerCurrency }
    )
  }

  const totalMinor = toAmountMinor(input.total, `Vendor credit ${number} total`)
  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Vendor credit ${number} totals ${totalMinor}. A credit relieves a payable, which is a ` +
        'positive whole number of minor units - a further charge is a bill, not a negative credit.',
      { vendorCreditId, number, totalMinor: String(totalMinor) }
    )
  }

  // Batched rather than fail-fast, like the expense bill's: four uncoded lines
  // are named in one refusal so they are coded in one pass.
  const uncoded: string[] = []
  const coded: Array<{ lineId: string; glAccountId: string; amountMinor: number; memo: string }> =
    []
  let codedMinor = 0

  for (const [index, line] of input.lines.entries()) {
    const label = line.description?.trim() || `Line ${index + 1}`
    const amountMinor = toAmountMinor(line.amount, `Vendor credit ${number} ${label}`)
    codedMinor += amountMinor
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
      memo: line.description?.trim() || `Vendor credit ${number}`,
    })
  }

  if (uncoded.length > 0) {
    throw new UnprocessableEntityError(
      `Vendor credit ${number} has ${uncoded.length === 1 ? 'a line' : `${uncoded.length} lines`} ` +
        `with no GL account: ${uncoded.join(', ')}. Code ${uncoded.length === 1 ? 'it' : 'them'} ` +
        'to the account the original charge went to - there is no default to fall back on, and ' +
        'guessing one gives money back somewhere nobody will ever look.',
      { vendorCreditId, number, lines: uncoded.join(', ') }
    )
  }

  if (coded.length === 0) {
    throw new UnprocessableEntityError(
      `Vendor credit ${number} has no line that moves money, so there is no entry to build.`,
      { vendorCreditId, number }
    )
  }

  if (codedMinor !== totalMinor) {
    const difference = totalMinor - codedMinor
    throw new UnprocessableEntityError(
      `Vendor credit ${number} totals ${totalMinor} but its coded lines sum to ${codedMinor}, a ` +
        `difference of ${difference}. The entry ties to the total or it does not post. Header tax ` +
        'carries no account of its own: add a line for it and code it, rather than letting the ' +
        'difference land on an account nothing chose.',
      {
        vendorCreditId,
        number,
        totalMinor: String(totalMinor),
        codedMinor: String(codedMinor),
        differenceMinor: String(difference),
      }
    )
  }

  const source = { sourceType: VENDOR_CREDIT_SOURCE_TYPE, sourceId: vendorCreditId }

  // ONE payable debit for the whole credit, and the only line carrying the
  // counterparty - the mirror of the expense bill's single A/P credit.
  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
      direction: 'debit',
      amount: totalMinor,
      memo: memo ?? `Vendor credit ${number}`,
      sortOrder: 0,
      ...(vendorCompanyInstanceId
        ? { counterpartyType: 'vendor' as const, counterpartyId: vendorCompanyInstanceId }
        : {}),
    },
  ]

  for (const [index, line] of coded.entries()) {
    lines.push({
      ...source,
      glAccountId: line.glAccountId,
      direction: line.amountMinor > 0 ? ('credit' as const) : ('debit' as const),
      amount: Math.abs(line.amountMinor),
      memo: line.memo,
      sortOrder: index + 1,
    })
  }

  return {
    entry: buildEntry({
      postingType: VENDOR_CREDIT_POSTING_TYPE,
      periodKey: number,
      txnDate: issuedAt,
      lines,
    }),
    periodKey: number,
    totalMinor,
    creditLines: coded.map((line) => ({
      lineId: line.lineId,
      glAccountId: line.glAccountId,
      amountMinor: line.amountMinor,
    })),
  }
}

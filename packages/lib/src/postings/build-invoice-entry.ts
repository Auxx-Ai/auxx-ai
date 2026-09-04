// packages/lib/src/postings/build-invoice-entry.ts

/**
 * The invoice issuance entry: the receivable nothing used to debit.
 *
 * PURE. No database, no clock, no chart.
 *
 * ```
 *   Dr accounts_receivable        total
 *       Cr revenue_service          total - tax
 *       Cr sales_tax_payable        tax
 * ```
 *
 * ## What this closes
 *
 * Every invoice the product issued was collected against a receivable that was
 * never raised, and booked revenue that never reached the profit and loss. A
 * $2,000 work-order invoice sent and paid posted nothing on issuance and
 * `Dr 1050 / Cr 1100` on payment, so `1100` ran contra by the whole service
 * book and service revenue appeared in no account at all. The trial balance
 * still tied, because every entry that existed balanced in isolation. The
 * write-off path made it worse: `build-write-off-entry.ts` credits
 * `accounts_receivable` for an invoice whose receivable was never raised.
 *
 * ## Recognition is on ISSUANCE, and that is not a contradiction
 *
 * `build-fulfillment-entry.ts` says recognition is on SHIPMENT, never on the
 * invoice, and that statement is about GOODS. It stays true for orders: an
 * order's invoice date and delivery date routinely differ, and recognising a
 * shipped product on paper misstates the period. A service invoice has no
 * shipment, so issuance is the only event there is - the work is billed, the
 * customer owes it. The two rules are one policy read on two document
 * families.
 *
 * 🛑 `invoice` and `order` are DISJOINT. The invoice registry relates to
 * `contact`, `work_order`, `line_item` and `payment`; there is no order field
 * on an invoice and no invoice field on an order, in either direction. So no
 * code path can produce both a fulfillment entry and an issuance entry for one
 * sale, and the system cannot double-count. A human hand-keying an invoice for
 * a sale that also shipped as an order still can, which is a release-note line
 * rather than something a builder can prevent.
 *
 * ## 🛑 Derive the discount, never recompute it
 *
 * `invoice_discount_amount` is not stored - only `discountType` and
 * `discountValue` are, and `computeDocumentTotals` derives the amount. A second
 * implementation of that arithmetic in here would be free to drift from the
 * stored total. So revenue is `totalMinor - taxTotalMinor`, and the entry ties
 * to the document it came from BY CONSTRUCTION. An entry that does not tie to
 * its document is worse than no entry, which is the same reasoning that makes a
 * vendor bill's totals transcribed and never computed
 * (`docs/inventory-costing-architecture-guide.md` §9).
 *
 * `subtotalMinor` is therefore carried for the memo and for the caller's own
 * assertions, never for the arithmetic.
 *
 * ⚠️ An invoice has no shipping field. `computeDocumentTotals` takes a shipping
 * argument for the ORDER's sake; on an invoice it is zero and
 * `total = subtotal - discount + tax`. There is no `revenue_shipping` leg here.
 *
 * @see plans/accounting/tasks/08-invoice-revenue.md
 */

import { UnprocessableEntityError } from '../errors'
import { ACCOUNT_ROLES, buildEntry } from './build-entry'
import { toAmountMinor } from './build-fulfillment-entry'
import { assertCompactablePeriodKey } from './period-key'
import type { BuiltEntry, GlPostingLineInput } from './types'

/**
 * The `sourceType` every issuance line carries: the `invoice` record.
 *
 * The same value `build-write-off-entry.ts` uses, on purpose. A/R aging already
 * understands `sourceType: 'invoice'` and already resolves an invoice's own due
 * date for bucketing, so an issuance entry lands in its due-date bucket with no
 * further work rather than in "Unapplied and adjustments".
 */
export const INVOICE_SOURCE_TYPE = 'invoice'

/** The posting type an issuance entry claims. Prefix `INI`; `INV` is taken. */
export const INVOICE_ISSUED_POSTING_TYPE = 'invoice_issued' as const

export interface BuildInvoiceEntryInput {
  /** The `invoice` EntityInstance id. Becomes every line's `sourceId`. */
  invoiceId: string
  /**
   * The invoice's own number (`'INV-0042'`). `periodKey` keys on this,
   * compacted, exactly as `manual_journal`, `bank_deposit` and `write_off` key
   * on their own record's number - never a cuid, which is 24 characters on its
   * own, and never a date, because many invoices are issued in one day.
   *
   * One entry per invoice falls out of the claim's unique index for free: a
   * second issuance of the same invoice claims the same
   * `(org, invoice_issued, periodKey, revision=0)` tuple and converges to
   * `already_posted`.
   */
  invoiceNumber: string
  /** `YYYY-MM-DD`. The invoice's own `issuedAt`, honouring a deliberate backdate. */
  issuedAt: string
  /**
   * `invoice_subtotal`, integer minor units. Read for the memo and the caller's
   * assertions; the revenue leg is derived from the total, never from this.
   */
  subtotalMinor: number | null | undefined
  /** `invoice_tax_total`, integer minor units. Zero is ordinary. */
  taxTotalMinor: number | null | undefined
  /** `invoice_total`, integer minor units. The receivable, and the tie point. */
  totalMinor: number | null | undefined
  memo?: string
}

export interface BuiltInvoiceEntry {
  entry: BuiltEntry
  periodKey: string
  /** The receivable raised. Equals the invoice's stored total. */
  totalMinor: number
  /** `totalMinor - taxTotalMinor`. Derived, never recomputed from the lines. */
  revenueMinor: number
  /** The pass-through liability leg. `0` omits it. */
  taxTotalMinor: number
  /**
   * The invoice's stored subtotal, validated as whole minor units.
   *
   * Carried so a caller can assert `subtotal - discount + tax === total` if it
   * wants to. It drives NO leg: the revenue credit is `total - tax`, so the
   * entry ties to the stored total by construction even on a discounted
   * invoice whose discount amount is not stored anywhere.
   */
  subtotalMinor: number
}

/**
 * Build the issuance entry for one invoice.
 *
 * @throws {UnprocessableEntityError} on a blank or over-long invoice number, a
 *   total that is not a positive whole number of minor units, a negative tax or
 *   one that exceeds the total, or a derived revenue that is zero or negative
 *   (an invoice that is all tax).
 */
export function buildInvoiceEntry(input: BuildInvoiceEntryInput): BuiltInvoiceEntry {
  const { invoiceId, issuedAt, memo } = input

  const invoiceNumber = assertCompactablePeriodKey({
    value: input.invoiceNumber,
    label: 'Invoice number',
    remedy:
      'Shorten the invoice number, or raise the receivable with a manual journal entry instead.',
    context: { invoiceId },
  })

  // `FieldValue.valueNumber` is a `doublePrecision` column and every one of
  // `invoice_subtotal`, `invoice_tax_total` and `invoice_total` lives in it, so
  // `200000` reads back as `199999.99999999997`. `toAmountMinor` rounds the
  // double's own noise floor and refuses a genuinely fractional value.
  const totalMinor = toAmountMinor(input.totalMinor, `Invoice ${invoiceNumber} total`)
  const taxTotalMinor = toAmountMinor(input.taxTotalMinor, `Invoice ${invoiceNumber} tax`)
  const subtotalMinor = toAmountMinor(input.subtotalMinor, `Invoice ${invoiceNumber} subtotal`)

  if (totalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Invoice ${invoiceNumber} totals ${totalMinor}. An issuance entry raises a receivable, ` +
        'which is a positive whole number of minor units - a credit is a credit memo, not a ' +
        'negative invoice.',
      { invoiceId, invoiceNumber, totalMinor: String(totalMinor) }
    )
  }
  if (taxTotalMinor < 0) {
    throw new UnprocessableEntityError(
      `Invoice ${invoiceNumber} has ${taxTotalMinor} of tax. Tax collected is never negative - ` +
        'sign lives in the line direction, not in the amount.',
      { invoiceId, invoiceNumber, taxTotalMinor: String(taxTotalMinor) }
    )
  }
  if (taxTotalMinor > totalMinor) {
    throw new UnprocessableEntityError(
      `Invoice ${invoiceNumber} carries ${taxTotalMinor} of tax on a total of ${totalMinor}. ` +
        'The tax cannot exceed what the customer was billed.',
      {
        invoiceId,
        invoiceNumber,
        taxTotalMinor: String(taxTotalMinor),
        totalMinor: String(totalMinor),
      }
    )
  }

  // Derived, not recomputed. See the file header.
  const revenueMinor = totalMinor - taxTotalMinor
  if (revenueMinor <= 0) {
    throw new UnprocessableEntityError(
      `Invoice ${invoiceNumber} is entirely tax (${taxTotalMinor} of ${totalMinor}), so it has ` +
        'no revenue to recognise. An invoice with no revenue line is a tax adjustment, and that ' +
        'is a manual journal entry.',
      {
        invoiceId,
        invoiceNumber,
        taxTotalMinor: String(taxTotalMinor),
        totalMinor: String(totalMinor),
      }
    )
  }

  const lineMemo = memo ?? `Invoice ${invoiceNumber}`
  const source = { sourceType: INVOICE_SOURCE_TYPE, sourceId: invoiceId }

  const lines: GlPostingLineInput[] = [
    {
      ...source,
      accountRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      direction: 'debit',
      amount: totalMinor,
      memo: lineMemo,
      sortOrder: 0,
    },
    {
      ...source,
      accountRole: ACCOUNT_ROLES.REVENUE_SERVICE,
      direction: 'credit',
      amount: revenueMinor,
      memo: lineMemo,
      sortOrder: 1,
    },
  ]

  if (taxTotalMinor > 0) {
    lines.push({
      ...source,
      accountRole: ACCOUNT_ROLES.SALES_TAX_PAYABLE,
      direction: 'credit',
      amount: taxTotalMinor,
      memo: `${lineMemo} sales tax`,
      sortOrder: 2,
    })
  }

  return {
    entry: buildEntry({
      postingType: INVOICE_ISSUED_POSTING_TYPE,
      periodKey: invoiceNumber,
      txnDate: issuedAt,
      lines,
    }),
    periodKey: invoiceNumber,
    totalMinor,
    revenueMinor,
    taxTotalMinor,
    subtotalMinor,
  }
}

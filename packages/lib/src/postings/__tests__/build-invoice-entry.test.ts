// packages/lib/src/postings/__tests__/build-invoice-entry.test.ts
//
// Three of these are worth more than the arithmetic:
//
//  1. **Revenue is DERIVED as `total - tax`, never recomputed from the
//     discount.** `invoice_discount_amount` is not stored, so recomputing it
//     here would be a second implementation of `computeDocumentTotals` free to
//     drift. The discounted-invoice test is what pins that: the entry ties to
//     the STORED total.
//  2. **The stored totals are doubles.** `FieldValue.valueNumber` is
//     `doublePrecision`, so `200000` reads back as `199999.99999999997`.
//  3. **`INV` is `month_end_inventory`'s prefix**, so an issuance entry cannot
//     reuse it. The document-number test is what stops somebody "tidying" the
//     prefix later.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildInvoiceEntry, INVOICE_SOURCE_TYPE } from '../build-invoice-entry'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'

const BASE = {
  invoiceId: 'ei_invoice_1',
  invoiceNumber: 'INV-0042',
  issuedAt: '2026-09-04',
  subtotalMinor: 200_000,
  taxTotalMinor: 16_500,
  totalMinor: 216_500,
}

function line(entry: ReturnType<typeof buildInvoiceEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

describe('a plain invoice', () => {
  it('debits the receivable for the total and credits revenue and tax', () => {
    const built = buildInvoiceEntry(BASE)

    expect(line(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.direction).toBe('debit')
    expect(line(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.amount).toBe(216_500)
    expect(line(built.entry, ACCOUNT_ROLES.REVENUE_SERVICE)?.direction).toBe('credit')
    expect(line(built.entry, ACCOUNT_ROLES.REVENUE_SERVICE)?.amount).toBe(200_000)
    expect(line(built.entry, ACCOUNT_ROLES.SALES_TAX_PAYABLE)?.amount).toBe(16_500)
    expect(built.entry.lines).toHaveLength(3)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('sources every line on the invoice, which is what aging buckets on', () => {
    const built = buildInvoiceEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(INVOICE_SOURCE_TYPE)
      expect(row.sourceId).toBe(BASE.invoiceId)
    }
  })

  it('books no shipping revenue leg, because an invoice carries no shipping', () => {
    const built = buildInvoiceEntry(BASE)
    expect(line(built.entry, ACCOUNT_ROLES.REVENUE_SHIPPING)).toBeUndefined()
  })

  it('dates the entry on the invoice issue date, honouring a backdate', () => {
    const built = buildInvoiceEntry({ ...BASE, issuedAt: '2026-07-31' })
    expect(built.entry.txnDate).toBe('2026-07-31')
  })
})

describe('a discounted invoice', () => {
  it('ties to the STORED total rather than to a recomputed discount', () => {
    // Subtotal 200,000, a 10% discount nobody stored the amount of, then tax on
    // the discounted base. Recomputing the discount here would be a second
    // implementation of `computeDocumentTotals`; deriving revenue as
    // `total - tax` makes the entry tie by construction.
    const built = buildInvoiceEntry({
      ...BASE,
      subtotalMinor: 200_000,
      taxTotalMinor: 14_850,
      totalMinor: 194_850,
    })

    expect(built.revenueMinor).toBe(180_000)
    expect(line(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.amount).toBe(194_850)
    expect(built.entry.totalDebit).toBe(194_850)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })
})

describe('zero tax', () => {
  it('drops the tax leg rather than posting a line that moves nothing', () => {
    const built = buildInvoiceEntry({ ...BASE, taxTotalMinor: 0, totalMinor: 200_000 })
    expect(built.entry.lines).toHaveLength(2)
    expect(line(built.entry, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toBeUndefined()
    expect(line(built.entry, ACCOUNT_ROLES.REVENUE_SERVICE)?.amount).toBe(200_000)
  })

  it('treats a missing tax value as zero, not as a refusal', () => {
    const built = buildInvoiceEntry({ ...BASE, taxTotalMinor: null, totalMinor: 200_000 })
    expect(built.taxTotalMinor).toBe(0)
    expect(built.revenueMinor).toBe(200_000)
  })
})

describe('the doubles the totals are stored in', () => {
  it('lands 199999.99999999997 on 200000', () => {
    const built = buildInvoiceEntry({
      ...BASE,
      taxTotalMinor: 0,
      totalMinor: 199_999.999_999_999_97,
    })
    expect(built.totalMinor).toBe(200_000)
    expect(built.revenueMinor).toBe(200_000)
  })

  it('refuses a genuinely fractional total rather than absorbing it', () => {
    expect(() => buildInvoiceEntry({ ...BASE, totalMinor: 216_500.5 })).toThrowError(
      /whole number of cents/
    )
  })
})

describe('refusals', () => {
  it('refuses a zero or negative total, naming the invoice', () => {
    for (const totalMinor of [0, -1]) {
      expect(() => buildInvoiceEntry({ ...BASE, totalMinor })).toThrowError(/INV-0042/)
    }
  })

  it('refuses negative tax', () => {
    expect(() => buildInvoiceEntry({ ...BASE, taxTotalMinor: -100 })).toThrowError(
      UnprocessableEntityError
    )
  })

  it('refuses tax that exceeds the total', () => {
    expect(() =>
      buildInvoiceEntry({ ...BASE, taxTotalMinor: 300_000, totalMinor: 216_500 })
    ).toThrowError(/cannot exceed/)
  })

  it('refuses an invoice that is all tax, because it recognises no revenue', () => {
    expect(() =>
      buildInvoiceEntry({ ...BASE, subtotalMinor: 0, taxTotalMinor: 16_500, totalMinor: 16_500 })
    ).toThrowError(/entirely tax/)
  })

  it('refuses a blank invoice number', () => {
    expect(() => buildInvoiceEntry({ ...BASE, invoiceNumber: '   ' })).toThrowError(
      /key its document number on/
    )
  })
})

describe('the period key', () => {
  it('is the invoice number, so one entry per invoice falls out of the claim', () => {
    expect(buildInvoiceEntry(BASE).periodKey).toBe('INV-0042')
    expect(buildInvoiceEntry(BASE).entry.periodKey).toBe('INV-0042')
  })

  it('never lets two invoices share one key', () => {
    const keys = new Set(
      ['INV-0001', 'INV-0002', 'INV-0042', 'SVC-9'].map(
        (invoiceNumber) => buildInvoiceEntry({ ...BASE, invoiceNumber }).periodKey
      )
    )
    expect(keys.size).toBe(4)
  })

  it('refuses a number that compacts past the cap, rather than posting an unreversible entry', () => {
    // Twelve compacted characters posts perfectly at revision 0 - `AUXX-INI-`
    // plus twelve is exactly 21 - and then refuses the day somebody reverses
    // it, at 24. The entry would be in the books with no way to take it out.
    expect(() => buildInvoiceEntry({ ...BASE, invoiceNumber: 'INV-012345678' })).toThrowError(
      /compacts to 12 characters/
    )
  })

  it('mints a document number that survives a reversal', () => {
    const built = buildInvoiceEntry(BASE)
    const reversal = buildDocNumber({
      postingType: 'invoice_issued',
      periodKey: built.periodKey,
      revision: 1,
    })
    expect(reversal).toBe('AUXX-INI-INV0042-R1')
    expect(reversal.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('does not reuse the month-end inventory prefix', () => {
    expect(DOC_NUMBER_PREFIX.invoice_issued).toBe('INI')
    expect(DOC_NUMBER_PREFIX.invoice_issued).not.toBe(DOC_NUMBER_PREFIX.month_end_inventory)
  })
})

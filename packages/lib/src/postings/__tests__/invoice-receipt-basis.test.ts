// packages/lib/src/postings/__tests__/invoice-receipt-basis.test.ts

import { describe, expect, it } from 'vitest'
import {
  acceptedCustomerReceiptEffectBasisSchema,
  customerReceiptCalculationSchema,
  invoiceReceiptAccountingBasisSchema,
} from '../effect-types'

const hash = 'a'.repeat(64)

/** A valid `invoice_receipt_v1` calculation: $120 received, whole invoice owed $200. */
const calculation = {
  version: 1 as const,
  kind: 'invoice_receipt' as const,
  moneyTransactionId: 'money-1',
  invoiceInstanceId: 'invoice-1',
  sourceHash: hash,
  occurredAt: '2026-09-15T18:00:00.000Z',
  occurredOn: null,
  effectiveDate: '2026-09-15',
  currency: 'USD' as const,
  currencyExponent: 2 as const,
  amountMinor: '120',
  receiptAmountMinor: '120',
  invoiceTotalMinor: '200',
  invoiceOutstandingMinor: '200',
  receivableMinor: '120',
  cashGlAccountId: 'gl-bank',
  debitSelectedBy: 'bank_account' as const,
  bankAccountInstanceId: 'bank-1',
  applications: [
    {
      applicationId: 'app-1',
      invoiceInstanceId: 'invoice-1',
      amountMinor: '120',
      effectiveDate: '2026-09-15',
    },
  ],
}

const accepted = {
  version: 1 as const,
  sourceBasisVersion: 1,
  sourceHash: hash,
  policyKey: 'invoice_receipt_v1' as const,
  policyVersion: 1 as const,
  effectiveDate: '2026-09-15',
  bookTimeZone: 'America/Los_Angeles',
  currency: 'USD' as const,
  currencyExponent: 2 as const,
  documentRefs: [
    { resourceKind: 'invoice', entityInstanceId: 'invoice-1' },
    { resourceKind: 'money_transaction', entityInstanceId: 'money-1' },
  ],
  calculation,
  accountResolution: [
    {
      lineKey: 'line:0',
      glAccountId: 'gl-bank',
      accountRole: null,
      selectedBy: 'document' as const,
      configurationHash: hash,
    },
    {
      lineKey: 'line:1',
      glAccountId: 'gl-ar',
      accountRole: 'accounts_receivable',
      selectedBy: 'org_role' as const,
      configurationHash: hash,
    },
  ],
  contribution: [
    {
      lineKey: 'line:0',
      glAccountId: 'gl-bank',
      direction: 'debit' as const,
      amountMinor: '120',
      counterpartyType: null,
      counterpartyId: null,
      dimensions: {},
    },
    {
      lineKey: 'line:1',
      glAccountId: 'gl-ar',
      direction: 'credit' as const,
      amountMinor: '120',
      counterpartyType: 'customer' as const,
      counterpartyId: 'customer-1',
      dimensions: {},
    },
  ],
}

describe('invoiceReceiptAccountingBasisSchema', () => {
  it('accepts a receipt that relieves part of an invoice', () => {
    expect(invoiceReceiptAccountingBasisSchema.safeParse(calculation).success).toBe(true)
  })

  it('refuses a receipt larger than what the invoice still owed', () => {
    const over = { ...calculation, invoiceOutstandingMinor: '100' }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(over).success).toBe(false)
  })

  it('refuses applications that do not sum to the receipt', () => {
    const short = {
      ...calculation,
      applications: [{ ...calculation.applications[0]!, amountMinor: '100' }],
    }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(short).success).toBe(false)
  })

  it('refuses an application naming another invoice', () => {
    const elsewhere = {
      ...calculation,
      applications: [{ ...calculation.applications[0]!, invoiceInstanceId: 'invoice-2' }],
    }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(elsewhere).success).toBe(false)
  })

  it('refuses a partial relief of the receivable — the whole receipt is owed money', () => {
    const partial = { ...calculation, receivableMinor: '60' }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(partial).success).toBe(false)
  })

  it('accepts an unbanked receipt sitting in undeposited funds', () => {
    const undeposited = {
      ...calculation,
      cashGlAccountId: 'gl-undeposited',
      debitSelectedBy: 'undeposited_funds' as const,
      bankAccountInstanceId: null,
    }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(undeposited).success).toBe(true)
  })

  it('refuses a bank-account receipt that names no bank account', () => {
    const orphan = { ...calculation, bankAccountInstanceId: null }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(orphan).success).toBe(false)
  })

  it('refuses an undeposited receipt that names a bank account anyway', () => {
    const both = { ...calculation, debitSelectedBy: 'undeposited_funds' as const }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(both).success).toBe(false)
  })

  it('accepts a date-precision receipt — a cheque recorded as "the 15th"', () => {
    const onADay = { ...calculation, occurredAt: null, occurredOn: '2026-09-15' }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(onADay).success).toBe(true)
  })

  it('refuses a receipt carrying both an instant and a date', () => {
    const both = { ...calculation, occurredOn: '2026-09-15' }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(both).success).toBe(false)
  })

  it('refuses a receipt carrying neither', () => {
    const neither = { ...calculation, occurredAt: null }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(neither).success).toBe(false)
  })

  it('pins a date-precision receipt to the day it occurred', () => {
    const drifted = { ...calculation, occurredAt: null, occurredOn: '2026-09-14' }
    expect(invoiceReceiptAccountingBasisSchema.safeParse(drifted).success).toBe(false)
  })
})

describe('customerReceiptCalculationSchema', () => {
  it('routes an invoice calculation to the invoice member and never to the order one', () => {
    const parsed = customerReceiptCalculationSchema.parse(calculation)
    expect('kind' in parsed && parsed.kind).toBe('invoice_receipt')
  })

  it('refuses an order-shaped calculation wearing the invoice discriminator', () => {
    const confused = { ...calculation, orderInstanceId: 'order-1' }
    expect(customerReceiptCalculationSchema.safeParse(confused).success).toBe(false)
  })
})

describe('acceptedCustomerReceiptEffectBasisSchema, invoice policy', () => {
  it('accepts the two-line entry', () => {
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(accepted).success).toBe(true)
  })

  it('refuses a policy key that disagrees with the calculation shape', () => {
    const mislabelled = { ...accepted, policyKey: 'shopify_receipt_v1' as const }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(mislabelled).success).toBe(false)
  })

  it('refuses a missing invoice document ref', () => {
    const orphan = {
      ...accepted,
      documentRefs: [{ resourceKind: 'money_transaction', entityInstanceId: 'money-1' }],
    }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(orphan).success).toBe(false)
  })

  it('ALLOWS a flipped entry — that is what a correction is', () => {
    // 🛑 The schema deliberately does not pin cash to the debit side: a
    // correction of a receipt is the original with its signs flipped, and
    // pinning it here made corrections unrepresentable. `accept-entry.ts`
    // asserts direction for originals, where `work.operation` is known.
    const flipped = {
      ...accepted,
      contribution: [
        { ...accepted.contribution[0]!, direction: 'credit' as const },
        { ...accepted.contribution[1]!, direction: 'debit' as const },
      ],
    }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(flipped).success).toBe(true)
  })

  it('still refuses a cash account that moves by the wrong amount', () => {
    const wrong = {
      ...accepted,
      calculation: { ...calculation, amountMinor: '120', receiptAmountMinor: '120' },
      contribution: [
        { ...accepted.contribution[0]!, amountMinor: '90' },
        { ...accepted.contribution[1]!, amountMinor: '90' },
      ],
    }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(wrong).success).toBe(false)
  })

  it('accepts a date-precision receipt without a timezone conversion', () => {
    const onADay = {
      ...accepted,
      calculation: { ...calculation, occurredAt: null, occurredOn: '2026-09-15' },
    }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(onADay).success).toBe(true)
  })

  it('still converts an INSTANT into the book day, and refuses a mismatch', () => {
    const wrongZone = { ...accepted, bookTimeZone: 'Pacific/Kiritimati' }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(wrongZone).success).toBe(false)
  })

  it('refuses an unbalanced contribution', () => {
    const unbalanced = {
      ...accepted,
      contribution: [
        accepted.contribution[0]!,
        { ...accepted.contribution[1]!, amountMinor: '110' },
      ],
    }
    expect(acceptedCustomerReceiptEffectBasisSchema.safeParse(unbalanced).success).toBe(false)
  })
})

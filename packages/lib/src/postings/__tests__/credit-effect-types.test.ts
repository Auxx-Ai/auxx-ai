// packages/lib/src/postings/__tests__/credit-effect-types.test.ts

import { describe, expect, it } from 'vitest'
import {
  acceptedCustomerCreditEffectBasisSchema,
  customerCreditAccountingBasisSchema,
} from '../credit-effect-types'
import {
  customerCreditAccountingEffectKey,
  customerCreditBasisFromMemo,
} from '../credit-effect-work'

const HASH = 'a'.repeat(64)

function calculation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    creditMemoInstanceId: 'memo_1',
    sourceHash: HASH,
    source: 'native',
    number: 'CM-0001',
    contactInstanceId: 'contact_1',
    invoiceInstanceId: 'invoice_1',
    orderInstanceId: null,
    sourceStoreId: 'store_1',
    creditControlGlAccountId: 'gl_ar',
    issuedAt: '2026-09-15',
    effectiveDate: '2026-09-15',
    currency: 'USD',
    currencyExponent: 2,
    subtotalMinor: '1000',
    taxTotalMinor: '100',
    totalMinor: '1100',
    reverseRevenue: true,
    components: [
      {
        componentKey: 'earned_revenue',
        accountRole: 'revenue_returns_allowances',
        direction: 'debit',
        amountMinor: '1000',
      },
      {
        componentKey: 'sales_tax',
        accountRole: 'sales_tax_payable',
        direction: 'debit',
        amountMinor: '100',
      },
    ],
    sourceAllocations: [],
    ...overrides,
  }
}

function accepted(overrides: Record<string, unknown> = {}) {
  const lines = [
    {
      lineKey: 'returns',
      glAccountId: 'gl_returns',
      direction: 'debit',
      amountMinor: '1000',
      counterpartyType: null,
      counterpartyId: null,
      dimensions: {},
    },
    {
      lineKey: 'tax',
      glAccountId: 'gl_tax',
      direction: 'debit',
      amountMinor: '100',
      counterpartyType: null,
      counterpartyId: null,
      dimensions: {},
    },
    {
      lineKey: 'receivable',
      glAccountId: 'gl_ar',
      direction: 'credit',
      amountMinor: '1100',
      counterpartyType: 'customer',
      counterpartyId: 'contact_1',
      dimensions: {},
    },
  ] as const
  return {
    version: 1,
    sourceBasisVersion: 1,
    sourceHash: HASH,
    policyKey: 'customer_credit_issued_v1',
    policyVersion: 1,
    effectiveDate: '2026-09-15',
    bookTimeZone: 'America/Los_Angeles',
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [{ resourceKind: 'credit_memo', entityInstanceId: 'memo_1' }],
    calculation: calculation(),
    accountResolution: lines.map((line) => ({
      lineKey: line.lineKey,
      glAccountId: line.glAccountId,
      accountRole:
        line.lineKey === 'receivable'
          ? 'accounts_receivable'
          : line.lineKey === 'tax'
            ? 'sales_tax_payable'
            : 'revenue_returns_allowances',
      selectedBy: 'org_role' as const,
      configurationHash: HASH,
    })),
    contribution: lines,
    ...overrides,
  }
}

describe('customer credit accounting effect contracts', () => {
  it('builds a ready entitlement basis without provider or refund fields', () => {
    const basis = customerCreditBasisFromMemo({
      creditMemoInstanceId: 'memo_1',
      source: 'channel',
      number: 'CM-0001',
      contactInstanceId: 'contact_1',
      invoiceInstanceId: null,
      orderInstanceId: 'order_1',
      sourceStoreId: 'store_1',
      creditControlGlAccountId: 'gl_ar',
      issuedAt: '2026-09-15',
      subtotalMinor: 1000,
      taxTotalMinor: 100,
      totalMinor: 1100,
      sourceHash: HASH,
      reverseRevenue: true,
      components: [
        {
          componentKey: 'earned_revenue',
          accountRole: 'revenue_returns_allowances',
          direction: 'debit',
          amountMinor: 1000,
        },
        {
          componentKey: 'sales_tax',
          accountRole: 'sales_tax_payable',
          direction: 'debit',
          amountMinor: 100,
        },
      ],
      sourceAllocations: [
        {
          effectId: 'effect_1',
          lineKey: 'revenue',
          amountMinor: 1000,
          componentKey: 'earned_revenue',
        },
        { effectId: 'effect_2', lineKey: 'tax', amountMinor: 100, componentKey: 'sales_tax' },
      ],
    })
    expect(basis.status).toBe('ready')
    expect(basis.calculation).not.toHaveProperty('amountRefundedMinor')
    expect(basis.calculation).not.toHaveProperty('provider')
    expect(basis.calculation.totalMinor).toBe('1100')
  })

  it('supports a pre-fulfillment credit by naming the deposit component', () => {
    const basis = customerCreditBasisFromMemo({
      creditMemoInstanceId: 'memo_1',
      source: 'channel',
      number: 'CM-0001',
      contactInstanceId: 'contact_1',
      invoiceInstanceId: null,
      orderInstanceId: 'order_1',
      sourceStoreId: 'store_1',
      creditControlGlAccountId: 'gl_deposit',
      issuedAt: '2026-09-15',
      subtotalMinor: 1000,
      taxTotalMinor: 0,
      totalMinor: 1000,
      sourceHash: HASH,
      reverseRevenue: false,
      components: [
        {
          componentKey: 'customer_deposit',
          accountRole: 'customer_deposits',
          direction: 'debit',
          amountMinor: 1000,
        },
      ],
      sourceAllocations: [
        {
          effectId: 'effect_1',
          lineKey: 'deposit',
          amountMinor: 1000,
          componentKey: 'customer_deposit',
        },
      ],
    })
    expect(basis.calculation.components[0]?.componentKey).toBe('customer_deposit')
  })

  it('requires independently balanced, resolved contributions', () => {
    expect(acceptedCustomerCreditEffectBasisSchema.parse(accepted()).policyKey).toBe(
      'customer_credit_issued_v1'
    )
    expect(() =>
      acceptedCustomerCreditEffectBasisSchema.parse({
        ...accepted(),
        contribution: accepted().contribution.map((line, index) =>
          index === 0 ? { ...line, amountMinor: '999' } : line
        ),
      })
    ).toThrow(/balance|equal/)
  })

  it('keys original work on the credit memo identity only', () => {
    expect(customerCreditAccountingEffectKey('memo_1')).toBe(
      'customer_credit_issued:["memo_1","original"]'
    )
  })
})

describe('customer credit calculation schema', () => {
  it('rejects a refund amount in the entitlement basis', () => {
    expect(() =>
      customerCreditAccountingBasisSchema.parse({
        ...calculation(),
        amountRefundedMinor: '100',
      })
    ).toThrow()
  })
})

// packages/lib/src/accounting/ledger/builders/__tests__/credit-memo-entitlement.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildCreditMemoEntitlementEntry,
  type CreditMemoEntitlementComponent,
} from '../credit-memo'

const base = {
  creditMemoId: 'memo_1',
  number: 'CM-0001',
  issuedAt: '2026-09-15',
  currency: 'USD',
  ledgerCurrency: 'USD',
  total: 1100,
  creditControlGlAccountId: 'gl_ar',
  contactInstanceId: 'contact_1',
}

describe('buildCreditMemoEntitlementEntry', () => {
  it('posts earned revenue and tax against the frozen control account', () => {
    const components: CreditMemoEntitlementComponent[] = [
      {
        componentKey: 'earned_revenue',
        accountRole: 'revenue_returns_allowances',
        direction: 'debit',
        amount: 1000,
      },
      {
        componentKey: 'sales_tax',
        accountRole: 'sales_tax_payable',
        direction: 'debit',
        amount: 100,
      },
    ]
    const built = buildCreditMemoEntitlementEntry({ ...base, components })
    expect(built.entry.postingType).toBe('credit_memo')
    expect(built.entry.totalDebit).toBe(1100)
    expect(built.entry.totalCredit).toBe(1100)
    expect(
      built.entry.lines.map((line) => [line.glAccountId, line.direction, line.amount])
    ).toEqual([
      [undefined, 'debit', 1000],
      [undefined, 'debit', 100],
      ['gl_ar', 'credit', 1100],
    ])
  })

  it('keeps a pre-shipment deposit component separate from cash refund evidence', () => {
    const built = buildCreditMemoEntitlementEntry({
      ...base,
      total: 1000,
      creditControlGlAccountId: 'gl_deposit',
      components: [
        {
          componentKey: 'customer_deposit',
          accountRole: 'customer_deposits',
          direction: 'debit',
          amount: 1000,
        },
      ],
    })
    expect(built.entry.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ glAccountId: 'gl_deposit', direction: 'credit', amount: 1000 }),
      ])
    )
    expect(built.entry.lines.some((line) => line.memo?.includes('refunded'))).toBe(false)
  })

  it('refuses a component total that does not equal the memo total', () => {
    expect(() =>
      buildCreditMemoEntitlementEntry({
        ...base,
        components: [
          {
            componentKey: 'earned_revenue',
            accountRole: 'revenue_returns_allowances',
            direction: 'debit',
            amount: 999,
          },
        ],
      })
    ).toThrow(/total the memo/)
  })
})

// packages/lib/src/postings/__tests__/account-label.test.ts

import { describe, expect, it } from 'vitest'
import { accountLabel, compareAccountsByCodeThenName } from '../account-label'
import { accountSubtypeLabel, GL_ACCOUNT_SUBTYPES } from '../account-subtype'

describe('accountLabel', () => {
  it('prints code then name, and the name alone without a code', () => {
    expect(accountLabel({ code: '1310', name: 'Raw Materials' })).toBe('1310 Raw Materials')
    expect(accountLabel({ code: null, name: 'Bank Fees' })).toBe('Bank Fees')
    expect(accountLabel({ name: 'Bank Fees' })).toBe('Bank Fees')
    expect(accountLabel({ code: '  ', name: 'Bank Fees' })).toBe('Bank Fees')
  })
})

describe('compareAccountsByCodeThenName', () => {
  it('orders coded accounts by code, then uncoded ones by name', () => {
    const sorted = [
      { code: null, name: 'Zeta' },
      { code: '2000', name: 'Accounts Payable' },
      { code: null, name: 'Alpha' },
      { code: '1000', name: 'Cash' },
    ].sort(compareAccountsByCodeThenName)
    expect(sorted.map((a) => a.name)).toEqual(['Cash', 'Accounts Payable', 'Alpha', 'Zeta'])
  })

  it('falls back to the name between two accounts sharing a code', () => {
    const sorted = [
      { code: '5000', name: 'Freight In' },
      { code: '5000', name: 'Cost of Goods Sold' },
    ].sort(compareAccountsByCodeThenName)
    expect(sorted.map((a) => a.name)).toEqual(['Cost of Goods Sold', 'Freight In'])
  })
})

describe('account subtype vocabulary', () => {
  it('has a label for every value and carries cost_of_goods_sold', () => {
    expect(GL_ACCOUNT_SUBTYPES).toContain('cost_of_goods_sold')
    for (const value of GL_ACCOUNT_SUBTYPES) {
      expect(accountSubtypeLabel(value)).not.toBe(value)
    }
  })
})

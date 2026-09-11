// packages/lib/src/money/quickbooks/__tests__/account-types.test.ts

import { describe, expect, it } from 'vitest'
import { GL_ACCOUNT_SUBTYPES } from '../../../postings/account-subtype'
import { GL_ACCOUNT_TYPES } from '../../../postings/default-chart'
import { quickbooksAccountType } from '../account-types'

describe('quickbooksAccountType', () => {
  it('always returns BOTH halves, for every classification and subtype', () => {
    // 🛑 The invariant the whole file exists for. QuickBooks accepts an
    // AccountType alone and then invents a subtype of its own - probed
    // 2026-09-10, an `Other Current Asset` came back as `EmployeeCashAdvances` -
    // and the subtype is what their reports group by. A pair with an empty half
    // is therefore not a partial answer, it is a wrong one.
    for (const classification of GL_ACCOUNT_TYPES) {
      for (const subtype of [null, ...GL_ACCOUNT_SUBTYPES]) {
        const pair = quickbooksAccountType(classification, subtype)
        expect(pair.accountType, `${classification}/${subtype}`).toBeTruthy()
        expect(pair.accountSubType, `${classification}/${subtype}`).toBeTruthy()
      }
    }
  })

  it('prefers the subtype when it agrees with the classification', () => {
    expect(quickbooksAccountType('asset', 'bank')).toEqual({
      accountType: 'Bank',
      accountSubType: 'Checking',
    })
    expect(quickbooksAccountType('expense', 'cost_of_goods_sold')).toEqual({
      accountType: 'Cost of Goods Sold',
      accountSubType: 'SuppliesMaterialsCogs',
    })
  })

  it('falls back to the classification for `other` and for no subtype', () => {
    // `other` means "no second fact", so it must not resolve to a pair of its
    // own - it has to read exactly like the null case.
    expect(quickbooksAccountType('asset', 'other')).toEqual(quickbooksAccountType('asset', null))
    expect(quickbooksAccountType('liability', null)).toEqual({
      accountType: 'Other Current Liability',
      accountSubType: 'OtherCurrentLiabilities',
    })
  })

  it('lets the CLASSIFICATION win when the two fields disagree', () => {
    // 🛑 The guard, not a formality. `subtype` and `accountType` are two
    // independently edited fields and nothing stops a `revenue` account carrying
    // `subtype: bank`. Sending `Bank` would create a real asset account in
    // somebody's books that our ledger then posts revenue into.
    expect(quickbooksAccountType('revenue', 'bank')).toEqual({
      accountType: 'Income',
      accountSubType: 'SalesOfProductIncome',
    })
    expect(quickbooksAccountType('asset', 'accounts_payable')).toEqual({
      accountType: 'Other Current Asset',
      accountSubType: 'OtherCurrentAssets',
    })
  })

  it('never defaults equity to one of QuickBooks own special accounts', () => {
    // Opening Balance Equity and Retained Earnings both have meanings Intuit
    // assigns itself; landing a chart account on either would be worse than
    // refusing.
    const equity = quickbooksAccountType('equity', null)
    expect(equity.accountSubType).not.toBe('OpeningBalanceEquity')
    expect(equity.accountSubType).not.toBe('RetainedEarnings')
  })
})

// apps/web/src/components/accounting/ui/__tests__/account-label-format.test.ts

import { describe, expect, it } from 'vitest'
import { accountChipText, accountMatchesSearch, formatAccountLabel } from '../account-label-format'

const numbered = { code: '1310', name: 'Inventory Raw Materials' }
const unnumbered = { code: null, name: 'Bank Fees' }

describe('formatAccountLabel', () => {
  it('joins code and name with a middot', () => {
    expect(formatAccountLabel(numbered)).toBe('1310 · Inventory Raw Materials')
  })

  it('renders the name alone when the code is null, undefined or blank', () => {
    expect(formatAccountLabel(unnumbered)).toBe('Bank Fees')
    expect(formatAccountLabel({ name: 'Bank Fees' })).toBe('Bank Fees')
    expect(formatAccountLabel({ code: '  ', name: 'Bank Fees' })).toBe('Bank Fees')
  })

  it('is empty for nothing', () => {
    expect(formatAccountLabel(null)).toBe('')
    expect(formatAccountLabel(undefined)).toBe('')
  })
})

describe('accountChipText', () => {
  it('prefers the code and falls back to the name', () => {
    expect(accountChipText(numbered)).toBe('1310')
    expect(accountChipText(unnumbered)).toBe('Bank Fees')
  })
})

describe('accountMatchesSearch', () => {
  it('matches on either half, case-insensitively', () => {
    expect(accountMatchesSearch(numbered, '13')).toBe(true)
    expect(accountMatchesSearch(numbered, 'raw mat')).toBe(true)
    expect(accountMatchesSearch(numbered, 'RAW')).toBe(true)
    expect(accountMatchesSearch(numbered, '9999')).toBe(false)
  })

  it('does not throw on a null code and matches everything on an empty search', () => {
    expect(accountMatchesSearch(unnumbered, '13')).toBe(false)
    expect(accountMatchesSearch(unnumbered, 'fees')).toBe(true)
    expect(accountMatchesSearch(unnumbered, '   ')).toBe(true)
  })
})

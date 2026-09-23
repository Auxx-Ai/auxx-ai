// packages/lib/src/accounting/providers/quickbooks/objects/__tests__/names.test.ts

import { describe, expect, it } from 'vitest'
import { itemName } from '../items'
import { quickbooksName } from '../shared'

describe('quickbooksName', () => {
  it('drops the colon QuickBooks reads as a sub-customer separator, and tabs and newlines', () => {
    expect(quickbooksName('auxx:Acme\tWest\nStore')).toBe('auxx Acme West Store')
  })

  it('leaves an acceptable name alone', () => {
    expect(quickbooksName('Demo Store (auxx)')).toBe('Demo Store (auxx)')
  })
})

describe('itemName', () => {
  it('names the generic item without a colon', () => {
    expect(itemName({ code: '4000', id: 'acc_1' })).toBe('auxx 4000')
    expect(itemName({ code: null, id: 'acc_1' })).toBe('auxx acc_1')
  })
})

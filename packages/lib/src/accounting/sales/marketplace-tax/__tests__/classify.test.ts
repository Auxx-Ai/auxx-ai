// packages/lib/src/accounting/sales/marketplace-tax/__tests__/classify.test.ts

import { describe, expect, it } from 'vitest'
import { workItemSentence } from '../../../work-items/codes'
import { classifyMarketplaceTax } from '../classify'

const TODAY = '2026-09-28'
const LONG_AGO = '2026-07-01'

const balance = (
  booked: number,
  returned: number,
  withheld: number,
  lastActivityOn = LONG_AGO
) => ({
  bookedMinor: booked,
  returnedMinor: returned,
  withheldMinor: withheld,
  lastActivityOn,
})

describe('classifyMarketplaceTax (116 §6)', () => {
  it('an order whose channel withheld exactly its tax is not flagged', () => {
    expect(classifyMarketplaceTax(balance(618, 0, 618), TODAY)).toBeNull()
  })

  it('a refunded order whose withheld tax was never returned is NOT_RETURNED (#14522)', () => {
    expect(classifyMarketplaceTax(balance(28257, 28257, 28257), TODAY)).toBe(
      'MARKETPLACE_TAX_NOT_RETURNED'
    )
  })

  it('flags nothing inside the grace window, and flags once it has passed', () => {
    expect(classifyMarketplaceTax(balance(28257, 28257, 28257, '2026-09-10'), TODAY)).toBeNull()
    expect(classifyMarketplaceTax(balance(28257, 28257, 28257, '2026-08-29'), TODAY)).toBe(
      'MARKETPLACE_TAX_NOT_RETURNED'
    )
  })

  it('a returned-tax credit that brings the withholding to zero clears it', () => {
    expect(classifyMarketplaceTax(balance(28257, 28257, 0), TODAY)).toBeNull()
  })

  it('withheld differing from the order tax is a MISMATCH (#14561)', () => {
    expect(classifyMarketplaceTax(balance(20140, 0, 20171), TODAY)).toBe('MARKETPLACE_TAX_MISMATCH')
  })

  it('tax withheld on an order with no channel-remitted tax is a MISMATCH', () => {
    expect(classifyMarketplaceTax(balance(0, 0, 500), TODAY)).toBe('MARKETPLACE_TAX_MISMATCH')
  })

  it('channel-remitted tax that no payout has withheld is NOT_WITHHELD', () => {
    expect(classifyMarketplaceTax(balance(618, 0, 0), TODAY)).toBe('MARKETPLACE_TAX_NOT_WITHHELD')
  })
})

describe('the marketplace-tax sentences', () => {
  it('name the order and the amounts from the item detail', () => {
    const detail = {
      orderNumber: '#14522',
      held: '$0.00',
      withheld: '$282.57',
      difference: '$282.57',
    }
    expect(workItemSentence('MARKETPLACE_TAX_NOT_RETURNED', { detail })).toBe(
      'Order #14522 was refunded, but the sales channel has not returned the $282.57 tax it withheld. Ask the channel to return it.'
    )
    expect(
      workItemSentence('MARKETPLACE_TAX_MISMATCH', {
        detail: { orderNumber: '#14561', held: '$201.40', withheld: '$201.71' },
      })
    ).toBe(
      "The sales channel withheld $201.71 tax on #14561; the order's channel-remitted tax is $201.40."
    )
  })
})

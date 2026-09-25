// apps/web/src/components/accounting/ui/ledger/outbox/blocked-levels.test.ts
import { describe, expect, it } from 'vitest'
import {
  groupId,
  itemNoun,
  reasonId,
  reasonTitle,
  refTitle,
  sourceBreakdown,
} from './blocked-levels'

describe('blocked levels', () => {
  it('titles a reason row by its refs and items', () => {
    expect(
      reasonTitle({
        reasonCode: 'STANDARD_COST_MISSING',
        refCount: 27,
        count: 1481,
        sourceKinds: ['fulfillment'],
      })
    ).toBe('Standard cost missing · 27 parts · 1,481 shipments')
    expect(
      reasonTitle({ reasonCode: 'SOME_NEW_CODE', refCount: 1, count: 1, sourceKinds: [] })
    ).toBe('Some new code · 1 group · 1 item')
  })

  it('titles a ref row by its label, falling back to the handle', () => {
    const base = { reasonCode: 'GATEWAY_UNMAPPED', count: 1, sourceKinds: ['money_transaction'] }
    expect(refTitle({ ...base, refLabel: null, externalRef: 'Affirm' })).toBe('Affirm · 1 payment')
    expect(refTitle({ ...base, refLabel: null, externalRef: null })).toBe(
      'No gateway linked · 1 payment'
    )
  })

  it('breaks a part row down by document kind, in shipment · build · count order, omitting zeros', () => {
    const part = {
      reasonCode: 'STANDARD_COST_MISSING',
      refLabel: 'The Attic-Lift',
      externalRef: 'part_1',
      count: 459,
      sourceKinds: ['stock_movement', 'fulfillment', 'build'],
      sourceKindCounts: { stock_movement: 1, build: 12, fulfillment: 446 },
    }
    expect(refTitle(part)).toBe('The Attic-Lift · 446 shipments · 12 builds · 1 count')
    expect(sourceBreakdown({ ...part, sourceKindCounts: { fulfillment: 0, build: 2 } })).toBe(
      '2 builds'
    )
    expect(sourceBreakdown({ count: 3, sourceKinds: ['stock_movement'] })).toBe('3 counts')
    // Without per-kind counts a mixed group is counted once, as items.
    expect(sourceBreakdown({ ...part, sourceKindCounts: null })).toBe('459 items')
    expect(reasonTitle({ ...part, refCount: 27 })).toBe(
      'Standard cost missing · 27 parts · 446 shipments · 12 builds · 1 count'
    )
  })

  it('names mixed sources as items, and never collides a reason with a group id', () => {
    expect(itemNoun(['fulfillment', 'payout'])).toEqual(['item', 'items'])
    expect(itemNoun(['provider_ledger_entry'])).toEqual(['connected books', 'connected books'])
    expect(itemNoun(['build'])).toEqual(['build', 'builds'])
    const key = { reasonCode: 'GATEWAY_UNMAPPED', role: null, railId: null, glAccountId: null }
    expect(reasonId('GATEWAY_UNMAPPED')).not.toBe(groupId(key))
  })
})

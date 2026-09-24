// apps/web/src/components/accounting/ui/ledger/outbox/blocked-levels.test.ts
import { describe, expect, it } from 'vitest'
import { groupId, itemNoun, reasonId, reasonTitle, refTitle } from './blocked-levels'

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

  it('names mixed sources as items, and never collides a reason with a group id', () => {
    expect(itemNoun(['fulfillment', 'payout'])).toEqual(['item', 'items'])
    expect(itemNoun(['provider_ledger_entry'])).toEqual(['connected books', 'connected books'])
    const key = { reasonCode: 'GATEWAY_UNMAPPED', role: null, railId: null, glAccountId: null }
    expect(reasonId('GATEWAY_UNMAPPED')).not.toBe(groupId(key))
  })
})

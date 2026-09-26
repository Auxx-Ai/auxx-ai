// packages/lib/src/inventory/costing/__tests__/suggest-standard-cost.test.ts

import { describe, expect, it } from 'vitest'
import { suggestStandardCost } from '../client'

describe('suggestStandardCost (09 D-SC4)', () => {
  it('prefers the supplier cost and hints the channel cost when they differ', () => {
    expect(suggestStandardCost(420, 380)).toEqual({
      unitCost: 420,
      source: 'supplier',
      other: { unitCost: 380, source: 'channel' },
    })
  })

  it('shows no hint when both agree', () => {
    expect(suggestStandardCost(420, 420)?.other).toBeNull()
  })

  it('falls back to the channel cost', () => {
    expect(suggestStandardCost(null, 12000)).toEqual({
      unitCost: 12000,
      source: 'channel',
      other: null,
    })
  })

  it('never suggests a zero', () => {
    expect(suggestStandardCost(0, 0)).toBeNull()
    expect(suggestStandardCost(0, 500)?.source).toBe('channel')
  })
})

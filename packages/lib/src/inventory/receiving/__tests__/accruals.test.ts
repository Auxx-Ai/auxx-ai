// packages/lib/src/inventory/receiving/__tests__/accruals.test.ts
//
// The arithmetic behind 73 §7.2's three credit legs. Pure - no mocks.

import { describe, expect, it } from 'vitest'
import { computeReceiptAccrual, landedUnitEstimate } from '../accruals'

// M: agreed 12.00, shipping 0.10, tariff 25%, other 0 -> landed 16.00.
const M = { agreedUnitPrice: 1_200, shippingCost: 100, otherCost: 0, tariffRate: 25 }

describe('landedUnitEstimate', () => {
  it('is the agreed price plus everything the receipt will accrue', () => {
    expect(landedUnitEstimate(M)).toBe(1_600)
  })

  it('is the agreed price alone when the supplier row has no adders', () => {
    expect(landedUnitEstimate({ agreedUnitPrice: 1_200 })).toBe(1_200)
  })

  it('rounds the tariff term alone, so the parts sum to the whole exactly', () => {
    // 1_233 at 7.5% is 92.475 -> 92; the three stored integers are untouched.
    expect(landedUnitEstimate({ agreedUnitPrice: 1_233, tariffRate: 7.5 })).toBe(1_325)
  })
})

describe('computeReceiptAccrual', () => {
  it('extends the three components over the quantity received', () => {
    expect(computeReceiptAccrual(M, 10)).toEqual({
      grniMinor: 12_000,
      freightMinor: 1_000,
      dutiesMinor: 3_000,
    })
  })

  it('folds other cost in with freight - both clear through the carrier accrual', () => {
    expect(computeReceiptAccrual({ ...M, otherCost: 50 }, 10).freightMinor).toBe(1_500)
  })

  it('leaves a missing component at zero, so its leg is never emitted', () => {
    expect(computeReceiptAccrual({ agreedUnitPrice: 1_200 }, 4)).toEqual({
      grniMinor: 4_800,
      freightMinor: 0,
      dutiesMinor: 0,
    })
  })

  it('returns whole minor units even from a fractional duty rate', () => {
    const accrual = computeReceiptAccrual({ agreedUnitPrice: 1_233, tariffRate: 7.5 }, 3)
    expect(accrual.dutiesMinor).toBe(277)
    expect(Number.isInteger(accrual.dutiesMinor)).toBe(true)
  })
})

// packages/lib/src/bom/vendor-cost.test.ts
//
// The landed formula and the winner rule are now shared between the cost
// calculator and the Suppliers drawer tab, so their contract is tested here
// once rather than asserted indirectly through `persistCosts`' writes.

import { describe, expect, it } from 'vitest'
import {
  computeLandedBreakdown,
  computeLandedCost,
  selectWinningVendor,
  type VendorCostRow,
} from './vendor-cost'

/** A priced offer; every cost is in minor units and `tariffRate` is a percent. */
function offer(id: string, overrides: Partial<VendorCostRow> = {}): VendorCostRow {
  return {
    id,
    unitPrice: 4000,
    shippingCost: null,
    tariffRate: null,
    otherCost: null,
    isPreferred: false,
    ...overrides,
  }
}

describe('computeLandedCost', () => {
  it('adds shipping, the tariff the rate produces, and other costs', () => {
    // $40.00 + $5.00 shipping + 10% of $40.00 + $1.00 other = $50.00
    expect(
      computeLandedCost(offer('a', { shippingCost: 500, tariffRate: 10, otherCost: 100 }))
    ).toBe(5000)
  })

  it('treats every absent component as zero, not as unknown', () => {
    expect(computeLandedCost(offer('a'))).toBe(4000)
  })

  it('is null for an unpriced offer rather than zero', () => {
    // An unpriced supplier row is not a free supplier — it cannot compete.
    expect(computeLandedCost(offer('a', { unitPrice: null }))).toBeNull()
  })

  it('keeps sub-minor-unit precision instead of rounding', () => {
    // This exact value is what gets persisted as part_cost; rounding here would
    // silently move every stored cost.
    expect(computeLandedCost(offer('a', { unitPrice: 4133, tariffRate: 7.5 }))).toBeCloseTo(
      4442.975,
      6
    )
  })
})

describe('computeLandedBreakdown', () => {
  it('splits the landed cost into components that sum to its own total', () => {
    const breakdown = computeLandedBreakdown(
      offer('a', { shippingCost: 500, tariffRate: 10, otherCost: 100 })
    )

    expect(breakdown).toEqual({
      unitPrice: 4000,
      shipping: 500,
      tariff: 400,
      tariffRate: 10,
      other: 100,
      landed: 5000,
    })
  })

  it('reports the tariff as currency, keeping the rate alongside it', () => {
    // "10%" without "$4.00" does not answer where the tariff went.
    const breakdown = computeLandedBreakdown(offer('a', { tariffRate: 10 }))
    expect(breakdown?.tariff).toBe(400)
    expect(breakdown?.tariffRate).toBe(10)
  })

  it('rounds a fractional tariff to a whole minor unit', () => {
    // 4133 * 7.5% = 309.975 -> 310
    const breakdown = computeLandedBreakdown(offer('a', { unitPrice: 4133, tariffRate: 7.5 }))
    expect(breakdown?.tariff).toBe(310)
    expect(breakdown?.landed).toBe(4443)
  })

  it('lands on the same whole minor unit as the exact total, for any rate', () => {
    // The guarantee the tooltip depends on: only the tariff term can be
    // fractional, so rounding it alone and summing equals rounding the sum.
    for (const unitPrice of [1, 7, 99, 4133, 12345, 999999]) {
      for (const tariffRate of [0, 2.5, 7.5, 10, 12.375, 33.333]) {
        const row = offer('a', { unitPrice, tariffRate, shippingCost: 517, otherCost: 89 })
        const exact = computeLandedCost(row)
        const breakdown = computeLandedBreakdown(row)
        expect(breakdown?.landed).toBe(Math.round(exact as number))
        expect(
          (breakdown as { unitPrice: number }).unitPrice +
            (breakdown as { shipping: number }).shipping +
            (breakdown as { tariff: number }).tariff +
            (breakdown as { other: number }).other
        ).toBe(breakdown?.landed)
      }
    }
  })

  it('is null for an unpriced offer', () => {
    expect(computeLandedBreakdown(offer('a', { unitPrice: null }))).toBeNull()
  })
})

describe('selectWinningVendor', () => {
  it('picks the cheapest LANDED offer, not the cheapest sticker price', () => {
    // Sticker order is bolt < acme < cheap; landed order is the exact reverse.
    const acme = offer('acme', { unitPrice: 4000, shippingCost: 500, tariffRate: 10 }) // 4900
    const bolt = offer('bolt', { unitPrice: 3800, shippingCost: 1500 }) // 5300
    const cheap = offer('cheap', { unitPrice: 4200, otherCost: 100 }) // 4300

    expect(selectWinningVendor([acme, bolt, cheap])?.id).toBe('cheap')
  })

  it('lets a preferred offer beat a cheaper one', () => {
    // Preference short-circuits the comparison; it is not a tiebreak.
    const acme = offer('acme', { unitPrice: 4900, isPreferred: true })
    const cheap = offer('cheap', { unitPrice: 4300 })

    expect(selectWinningVendor([acme, cheap])?.id).toBe('acme')
  })

  it('falls back to cheapest landed WITHIN the preferred group', () => {
    // Nothing enforces a single preferred row, so two can be preferred at once.
    const dear = offer('dear', { unitPrice: 5000, isPreferred: true })
    const near = offer('near', { unitPrice: 4700, isPreferred: true })
    const cheapest = offer('cheapest', { unitPrice: 100 })

    expect(selectWinningVendor([dear, near, cheapest])?.id).toBe('near')
  })

  it('excludes unpriced offers from the contest entirely', () => {
    const unpriced = offer('unpriced', { unitPrice: null, shippingCost: 1 })
    const priced = offer('priced', { unitPrice: 9999 })

    expect(selectWinningVendor([unpriced, priced])?.id).toBe('priced')
  })

  it('is null when nothing is priced', () => {
    expect(selectWinningVendor([offer('a', { unitPrice: null })])).toBeNull()
  })

  it('is null for no offers at all', () => {
    expect(selectWinningVendor([])).toBeNull()
  })

  it('breaks an exact tie on id, regardless of input order', () => {
    // Without this the winner depended on Postgres row order (the query has no
    // ORDER BY), so the UI marker would hop between two identical rows.
    const first = offer('bbb', { unitPrice: 4000 })
    const second = offer('aaa', { unitPrice: 4000 })

    expect(selectWinningVendor([first, second])?.id).toBe('aaa')
    expect(selectWinningVendor([second, first])?.id).toBe('aaa')
  })

  it('applies the id tiebreak only within the winning preference group', () => {
    // 'aaa' sorts first by id but is not preferred, so it must still lose.
    const plain = offer('aaa', { unitPrice: 4000 })
    const preferred = offer('zzz', { unitPrice: 4000, isPreferred: true })

    expect(selectWinningVendor([plain, preferred])?.id).toBe('zzz')
  })

  it('does not mutate the caller array', () => {
    const rows = [offer('b', { unitPrice: 100 }), offer('a', { unitPrice: 900 })]
    const order = rows.map((r) => r.id)

    selectWinningVendor(rows)

    expect(rows.map((r) => r.id)).toEqual(order)
  })
})

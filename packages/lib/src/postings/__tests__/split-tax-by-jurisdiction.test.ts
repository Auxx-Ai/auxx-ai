// packages/lib/src/postings/__tests__/split-tax-by-jurisdiction.test.ts
//
// The tie check is the load-bearing rule (brief 13 §5): a partial or
// mismatched jurisdiction breakdown must fall back to `null` rather than
// guess, because a partial split reads as a complete one. Everything else is
// the largest-remainder rounding that makes the shares sum exactly to the
// amount handed in.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { splitTaxByJurisdiction } from '../split-tax-by-jurisdiction'

describe('splitTaxByJurisdiction', () => {
  it('splits an amount across jurisdictions pro rata to their weights', () => {
    const shares = splitTaxByJurisdiction({
      taxMinor: 8_000,
      taxLines: [
        { title: 'CA State Tax', priceMinor: 6_000 },
        { title: 'CA District Tax', priceMinor: 2_000 },
      ],
      orderTaxTotalMinor: 8_000,
    })
    expect(shares).toEqual(
      expect.arrayContaining([
        { jurisdiction: 'CA State Tax', amountMinor: 6_000 },
        { jurisdiction: 'CA District Tax', amountMinor: 2_000 },
      ])
    )
    expect(shares).toHaveLength(2)
  })

  it('uses largest-remainder rounding so the shares sum exactly to taxMinor', () => {
    // Weights 1:2 applied to 77 cents: exact shares are 25.667 and 51.333.
    // The remainder cent goes to the larger fractional remainder (A).
    const shares = splitTaxByJurisdiction({
      taxMinor: 77,
      taxLines: [
        { title: 'A', priceMinor: 77 },
        { title: 'B', priceMinor: 154 },
      ],
      orderTaxTotalMinor: 231,
    })
    expect(shares).toEqual(
      expect.arrayContaining([
        { jurisdiction: 'A', amountMinor: 26 },
        { jurisdiction: 'B', amountMinor: 51 },
      ])
    )
    expect(shares?.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(77)
  })

  it('returns null when there are no tax lines at all', () => {
    expect(
      splitTaxByJurisdiction({ taxMinor: 100, taxLines: [], orderTaxTotalMinor: 100 })
    ).toBeNull()
  })

  it('returns null when taxMinor is zero, without even looking at the lines', () => {
    expect(
      splitTaxByJurisdiction({
        taxMinor: 0,
        taxLines: [{ title: 'A', priceMinor: 100 }],
        orderTaxTotalMinor: 100,
      })
    ).toBeNull()
  })

  it('returns null when the tax lines do not sum to the order total - a partial breakdown reads as complete', () => {
    expect(
      splitTaxByJurisdiction({
        taxMinor: 100,
        taxLines: [{ title: 'A', priceMinor: 60 }],
        orderTaxTotalMinor: 100,
      })
    ).toBeNull()
  })

  it('returns null when every tax line title is blank', () => {
    expect(
      splitTaxByJurisdiction({
        taxMinor: 100,
        taxLines: [{ title: '   ', priceMinor: 100 }],
        orderTaxTotalMinor: 100,
      })
    ).toBeNull()
  })

  it('sums multiple lines that share one jurisdiction title before splitting', () => {
    const shares = splitTaxByJurisdiction({
      taxMinor: 100,
      taxLines: [
        { title: 'CA State Tax', priceMinor: 40 },
        { title: 'CA State Tax', priceMinor: 60 },
      ],
      orderTaxTotalMinor: 100,
    })
    expect(shares).toEqual([{ jurisdiction: 'CA State Tax', amountMinor: 100 }])
  })

  it('drops a zero-amount jurisdiction share rather than posting a zero line', () => {
    const shares = splitTaxByJurisdiction({
      taxMinor: 100,
      taxLines: [
        { title: 'A', priceMinor: 100 },
        { title: 'B', priceMinor: 0 },
      ],
      orderTaxTotalMinor: 100,
    })
    expect(shares).toEqual([{ jurisdiction: 'A', amountMinor: 100 }])
  })

  it('refuses a fractional tax line price rather than absorbing it', () => {
    expect(() =>
      splitTaxByJurisdiction({
        taxMinor: 100,
        taxLines: [{ title: 'A', priceMinor: 99.5 }],
        orderTaxTotalMinor: 100,
      })
    ).toThrowError(UnprocessableEntityError)
  })

  it('refuses a fractional order tax total rather than absorbing it', () => {
    expect(() =>
      splitTaxByJurisdiction({
        taxMinor: 100,
        taxLines: [{ title: 'A', priceMinor: 100 }],
        orderTaxTotalMinor: 100.5,
      })
    ).toThrowError(UnprocessableEntityError)
  })
})

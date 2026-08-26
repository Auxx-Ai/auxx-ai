// apps/web/src/components/drawers/tabs/summarize-variants.test.ts
//
// The Variants tab's summary line (plans/products/09-variant-ui.md §4.3, §9).
// Every case here is a way the line could print a number that is not true:
// a never-counted family reading as zero stock, a price range built from
// inactive catalog items, `$199–$199`, or a page total presented as a family
// total.

import { describe, expect, it } from 'vitest'
import { buildVariantSummaryLabel, summarizeVariants, type VariantRow } from './summarize-variants'

/** Minor units in, plain dollars out — enough to assert against. */
const money = (minorUnits: number) => `$${(minorUnits / 100).toFixed(2)}`

const row = (overrides: Partial<VariantRow> = {}): VariantRow => ({
  id: 'part-1',
  quantityOnHand: 0,
  priceCents: null,
  catalogItemCount: 0,
  ...overrides,
})

describe('summarizeVariants', () => {
  it('returns an empty summary for no rows', () => {
    const summary = summarizeVariants([])
    expect(summary).toEqual({
      variantCount: 0,
      measuredCount: 0,
      totalOnHand: null,
      priceRange: null,
      pricedCount: 0,
      isPartial: false,
    })
  })

  it('sums only the rows that HAVE an on-hand value', () => {
    const summary = summarizeVariants([
      row({ id: 'a', quantityOnHand: 12 }),
      row({ id: 'b', quantityOnHand: null }),
      row({ id: 'c', quantityOnHand: 25 }),
    ])
    expect(summary.totalOnHand).toBe(37)
  })

  it('omits the on-hand clause when NO row has a value — never reports 0', () => {
    const summary = summarizeVariants([
      row({ id: 'a', quantityOnHand: null }),
      row({ id: 'b', quantityOnHand: null }),
    ])
    expect(summary.totalOnHand).toBeNull()
    expect(buildVariantSummaryLabel(summary, money)).toBe('2 variants')
  })

  it('keeps a genuine zero distinct from an absent value', () => {
    const summary = summarizeVariants([row({ id: 'a', quantityOnHand: 0 })])
    expect(summary.totalOnHand).toBe(0)
    expect(buildVariantSummaryLabel(summary, money)).toBe('1 variant · 0 on hand')
  })

  it('spans the price range over priced variants only', () => {
    // `priceCents: null` is how the tab reports "no catalog item", "inactive",
    // and "more than one item" alike — none may reach the range.
    const summary = summarizeVariants([
      row({ id: 'a', priceCents: 19900, catalogItemCount: 1 }),
      row({ id: 'b', priceCents: null, catalogItemCount: 0 }),
      row({ id: 'c', priceCents: null, catalogItemCount: 2 }),
      row({ id: 'd', priceCents: 34900, catalogItemCount: 1 }),
    ])
    expect(summary.priceRange).toEqual({ min: 19900, max: 34900 })
    expect(summary.pricedCount).toBe(2)
  })

  it('reports no range when nothing is priced', () => {
    const summary = summarizeVariants([row({ id: 'a' }), row({ id: 'b' })])
    expect(summary.priceRange).toBeNull()
    expect(summary.pricedCount).toBe(0)
  })

  it('counts the FAMILY when a total is supplied, not the loaded page', () => {
    const summary = summarizeVariants([row({ id: 'a' })], { total: 128, hasNextPage: true })
    expect(summary.variantCount).toBe(128)
    expect(summary.measuredCount).toBe(1)
    expect(summary.isPartial).toBe(true)
  })

  it('falls back to the row count when no total is in scope', () => {
    const summary = summarizeVariants([row({ id: 'a' }), row({ id: 'b' })])
    expect(summary.variantCount).toBe(2)
    expect(summary.isPartial).toBe(false)
  })
})

describe('buildVariantSummaryLabel', () => {
  it('renders the full line', () => {
    const summary = summarizeVariants([
      row({ id: 'a', quantityOnHand: 12, priceCents: 19900, catalogItemCount: 1 }),
      row({ id: 'b', quantityOnHand: 25, priceCents: 34900, catalogItemCount: 1 }),
    ])
    expect(buildVariantSummaryLabel(summary, money)).toBe(
      '2 variants · 37 on hand · $199.00–$349.00'
    )
  })

  it('renders a single distinct price as one figure, not a degenerate range', () => {
    const summary = summarizeVariants([
      row({ id: 'a', priceCents: 19900, catalogItemCount: 1 }),
      row({ id: 'b', priceCents: 19900, catalogItemCount: 1 }),
    ])
    expect(buildVariantSummaryLabel(summary, money)).toBe('2 variants · 0 on hand · $199.00')
  })

  it('pluralizes the count', () => {
    const one = summarizeVariants([row({ id: 'a', quantityOnHand: null })])
    expect(buildVariantSummaryLabel(one, money)).toBe('1 variant')
  })

  it('says the aggregates describe a page when more rows exist', () => {
    const summary = summarizeVariants(
      [
        row({ id: 'a', quantityOnHand: 12, priceCents: 19900, catalogItemCount: 1 }),
        row({ id: 'b', quantityOnHand: 25, priceCents: 34900, catalogItemCount: 1 }),
      ],
      { total: 128, hasNextPage: true }
    )
    expect(buildVariantSummaryLabel(summary, money)).toBe(
      '128 variants · 37 on hand · $199.00–$349.00 (first 2)'
    )
  })
})

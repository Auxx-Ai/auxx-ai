// apps/web/src/components/drawers/cards/part-sellable-state.test.ts

import { describe, expect, it } from 'vitest'
import { derivePricingCardState, isSoldAsIs } from './part-sellable-state'

const base = {
  partKind: 'finished_good',
  sellable: true,
  priceCents: 1999,
  markup: null,
  connectorPriced: false,
}

describe('isSoldAsIs', () => {
  it('is true for finished goods and services, scalar or array', () => {
    expect(isSoldAsIs('finished_good')).toBe(true)
    expect(isSoldAsIs(['service'])).toBe(true)
    for (const kind of [undefined, null, '', [], 'component', 'subassembly']) {
      expect(isSoldAsIs(kind)).toBe(false)
    }
  })
})

describe('derivePricingCardState', () => {
  it('shows an editable price, markup and no badge for a hand-priced sellable part', () => {
    expect(derivePricingCardState(base)).toEqual({
      showPricing: true,
      priceEditable: true,
      showMarkup: true,
      autoPriced: false,
      nudge: null,
    })
  })

  it('marks the price Auto when a markup is set', () => {
    expect(derivePricingCardState({ ...base, markup: 50 }).autoPriced).toBe(true)
  })

  it('hides pricing rows when not sellable, nudging only for kinds sold as they are', () => {
    const off = derivePricingCardState({ ...base, sellable: false })
    expect(off.showPricing).toBe(false)
    expect(off.nudge).toBe('not-sellable')
    expect(derivePricingCardState({ ...base, sellable: false, partKind: 'component' }).nudge).toBe(
      null
    )
  })

  it('nudges a sellable part with no price', () => {
    expect(derivePricingCardState({ ...base, priceCents: null }).nudge).toBe('no-price')
  })

  it('locks the price and drops markup for a connector-priced part', () => {
    const state = derivePricingCardState({ ...base, markup: 50, connectorPriced: true })
    expect(state.priceEditable).toBe(false)
    expect(state.showMarkup).toBe(false)
    expect(state.autoPriced).toBe(false)
  })
})

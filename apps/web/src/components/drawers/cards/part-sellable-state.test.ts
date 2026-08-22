// apps/web/src/components/drawers/cards/part-sellable-state.test.ts
//
// The Pricing card's derived state (plans/products/01-product-family.md §6.1):
// "sellable" is checked iff an ACTIVE catalog_item backs the part — never a
// stored boolean. The finished-good nudge is the ONLY partKind interplay;
// kinds classify for the GL, sellability is the catalog edge.

import { describe, expect, it } from 'vitest'
import {
  deriveSellableCardState,
  isFinishedGood,
  type SellableCatalogItem,
} from './part-sellable-state'

function item(overrides: Partial<SellableCatalogItem> = {}): SellableCatalogItem {
  return { id: 'item-1', name: 'Widget', active: true, priceCents: 1999, ...overrides }
}

describe('deriveSellableCardState', () => {
  it('hides everything until the reads have loaded — no flash of a wrong toggle', () => {
    expect(
      deriveSellableCardState({ loaded: false, items: [item()], partKind: 'finished_good' })
    ).toEqual({ kind: 'hidden' })
  })

  it('renders nothing for a part with no catalog item and no finished-good kind', () => {
    for (const partKind of [undefined, null, '', [], 'component', 'subassembly', ['component']]) {
      expect(deriveSellableCardState({ loaded: true, items: [], partKind })).toEqual({
        kind: 'hidden',
      })
    }
  })

  it('offers the create flow prominently for a finished good with no catalog item', () => {
    expect(deriveSellableCardState({ loaded: true, items: [], partKind: 'finished_good' })).toEqual(
      { kind: 'offer' }
    )
    // SINGLE_SELECT values are arrays on some read paths — same answer.
    expect(
      deriveSellableCardState({ loaded: true, items: [], partKind: ['finished_good'] })
    ).toEqual({ kind: 'offer' })
  })

  it('one active item → checked toggle, no nudge (sellable is the derived fact)', () => {
    const state = deriveSellableCardState({
      loaded: true,
      items: [item()],
      partKind: 'finished_good',
    })
    expect(state).toEqual({ kind: 'toggle', item: item(), showNudge: false })
  })

  it('one inactive item → unchecked toggle; nudges only for a finished good', () => {
    const inactive = item({ active: false })
    expect(
      deriveSellableCardState({ loaded: true, items: [inactive], partKind: 'finished_good' })
    ).toEqual({ kind: 'toggle', item: inactive, showNudge: true })
    // A component with an inactive item still shows the toggle (the fact
    // exists and re-checking must be possible) — just without the nudge.
    expect(
      deriveSellableCardState({ loaded: true, items: [inactive], partKind: 'component' })
    ).toEqual({ kind: 'toggle', item: inactive, showNudge: false })
    expect(deriveSellableCardState({ loaded: true, items: [inactive], partKind: null })).toEqual({
      kind: 'toggle',
      item: inactive,
      showNudge: false,
    })
  })

  it('multiple items → the compact list, never a toggle', () => {
    const items = [item(), item({ id: 'item-2', name: 'Widget (bulk)', priceCents: 1499 })]
    expect(deriveSellableCardState({ loaded: true, items, partKind: 'finished_good' })).toEqual({
      kind: 'list',
      items,
    })
  })
})

describe('isFinishedGood', () => {
  it('matches scalar and array-wrapped select values', () => {
    expect(isFinishedGood('finished_good')).toBe(true)
    expect(isFinishedGood(['finished_good'])).toBe(true)
  })

  it('rejects everything else, unset shapes included', () => {
    for (const value of [undefined, null, '', [], 'component', 'subassembly', ['component']]) {
      expect(isFinishedGood(value)).toBe(false)
    }
  })
})

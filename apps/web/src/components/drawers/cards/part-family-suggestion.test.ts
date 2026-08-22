// apps/web/src/components/drawers/cards/part-family-suggestion.test.ts
//
// The finished_good suggestion (plans/products/01-product-family.md §4) is
// gated on ALL of: (a) the part HAS a product, (b) it is nobody's subpart,
// (c) part_kind is unset — never over an explicit human choice. Gap C §3.2:
// a suggestion the human confirms, never a derivation.

import { describe, expect, it } from 'vitest'
import { isPartKindUnset, shouldSuggestFinishedGood } from './part-family-suggestion'

/** The all-conditions-met baseline each test perturbs one axis of. */
const ELIGIBLE = {
  hasProduct: true,
  partKind: undefined as unknown,
  subpartCheckLoaded: true,
  isSubpartOfAssembly: false,
}

describe('shouldSuggestFinishedGood', () => {
  it('suggests when the part has a product, is not a subpart, and part_kind is unset', () => {
    expect(shouldSuggestFinishedGood(ELIGIBLE)).toBe(true)
  })

  it('(a) never suggests without a product', () => {
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, hasProduct: false })).toBe(false)
  })

  it('(b) never suggests for a part used as a subpart of an assembly', () => {
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, isSubpartOfAssembly: true })).toBe(false)
  })

  it('(b) waits for the subpart-presence read — no flash while the answer is unknown', () => {
    expect(
      shouldSuggestFinishedGood({
        ...ELIGIBLE,
        subpartCheckLoaded: false,
        isSubpartOfAssembly: false,
      })
    ).toBe(false)
  })

  it('(c) never suggests over an explicit human choice — any set kind blocks it', () => {
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'component' })).toBe(false)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'subassembly' })).toBe(false)
    // Already finished_good: nothing to suggest.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'finished_good' })).toBe(false)
    // SINGLE_SELECT stored values are arrays on some read paths — same answer.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: ['component'] })).toBe(false)
  })

  it('(c) array-shaped and empty select values still read as unset', () => {
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: null })).toBe(true)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: '' })).toBe(true)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: [] })).toBe(true)
  })
})

describe('isPartKindUnset', () => {
  it('treats null, undefined, empty string, and empty array as unset', () => {
    expect(isPartKindUnset(undefined)).toBe(true)
    expect(isPartKindUnset(null)).toBe(true)
    expect(isPartKindUnset('')).toBe(true)
    expect(isPartKindUnset([])).toBe(true)
    expect(isPartKindUnset([''])).toBe(true)
  })

  it('treats any concrete value as set, scalar or array-wrapped', () => {
    expect(isPartKindUnset('component')).toBe(false)
    expect(isPartKindUnset(['finished_good'])).toBe(false)
  })
})

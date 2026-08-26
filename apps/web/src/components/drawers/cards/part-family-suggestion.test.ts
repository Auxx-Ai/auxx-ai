// apps/web/src/components/drawers/cards/part-family-suggestion.test.ts
//
// The finished_good suggestion (plans/products/01-product-family.md §4) is
// gated on ALL of: (a) the part HAS a product, (b) it is nobody's subpart,
// (c) part_kind is unset — never over an explicit human choice. Gap C §3.2:
// a suggestion the human confirms, never a derivation.

import { describe, expect, it } from 'vitest'
import {
  isPartKindUnset,
  shouldSuggestFamily,
  shouldSuggestFinishedGood,
} from './part-family-suggestion'

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

describe('shouldSuggestFamily', () => {
  it('suggests a family for an explicit finished good with no product', () => {
    expect(shouldSuggestFamily({ hasProduct: false, partKind: 'finished_good' })).toBe(true)
  })

  it('handles the array-shaped SINGLE_SELECT read the same way', () => {
    expect(shouldSuggestFamily({ hasProduct: false, partKind: ['finished_good'] })).toBe(true)
  })

  it('never suggests when the part already has a family', () => {
    expect(shouldSuggestFamily({ hasProduct: true, partKind: 'finished_good' })).toBe(false)
  })

  it('never suggests for other explicit kinds', () => {
    expect(shouldSuggestFamily({ hasProduct: false, partKind: 'component' })).toBe(false)
    expect(shouldSuggestFamily({ hasProduct: false, partKind: 'subassembly' })).toBe(false)
  })

  it('never suggests on an UNSET kind — finished_good is required explicitly, never inferred', () => {
    // Every shape `isPartKindUnset` treats as unset must also be silent here.
    for (const partKind of [undefined, null, '', [], ['']]) {
      expect(isPartKindUnset(partKind)).toBe(true)
      expect(shouldSuggestFamily({ hasProduct: false, partKind })).toBe(false)
    }
  })

  it('is mutually exclusive with the finished-good suggestion', () => {
    // The two gate on opposite sides of the same fact: one refuses to speak
    // OVER a human choice of part_kind, the other refuses to speak WITHOUT one.
    const cases: Array<{ hasProduct: boolean; partKind: unknown }> = [
      { hasProduct: false, partKind: undefined },
      { hasProduct: false, partKind: 'finished_good' },
      { hasProduct: false, partKind: 'component' },
      { hasProduct: true, partKind: undefined },
      { hasProduct: true, partKind: 'finished_good' },
      { hasProduct: true, partKind: 'component' },
    ]
    for (const input of cases) {
      const both =
        shouldSuggestFamily(input) &&
        shouldSuggestFinishedGood({
          ...input,
          subpartCheckLoaded: true,
          isSubpartOfAssembly: false,
        })
      expect(both).toBe(false)
    }
  })
})

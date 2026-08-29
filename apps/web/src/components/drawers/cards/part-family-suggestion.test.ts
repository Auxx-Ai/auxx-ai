// apps/web/src/components/drawers/cards/part-family-suggestion.test.ts
//
// The finished_good suggestion (plans/products/01-product-family.md §4) is
// gated on ALL of: (a) the part HAS a product, (b) it is nobody's subpart,
// (c) part_kind is UNCLASSIFIED. Gap C §3.2: a suggestion the human confirms,
// never a derivation.
//
// (c) used to mean "unset". Since 15-costing-usability.md §4c the `part_kind`
// field carries `defaultValue: 'component'`, so a stored `component` no longer
// proves a human typed it, and the unclassified set is "unset OR component".
// Leaving the gate at unset-only would have silently deleted the only safety
// net against a finished good posting to 1310 instead of 1330 on movement rows
// that are `updatable: false` and can never be corrected.

import { describe, expect, it } from 'vitest'
import {
  isPartKindUnclassified,
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

  it('(c) still suggests over a `component`, the field default, not a human choice', () => {
    // The load-bearing case: a finished good created through the form (or an
    // import, or the API) lands on `component` without anybody saying so.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'component' })).toBe(true)
    // SINGLE_SELECT stored values are arrays on some read paths, same answer.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: ['component'] })).toBe(true)
  })

  it('(c) never suggests over a deliberate classification', () => {
    // Neither of these is reachable without somebody picking it.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'subassembly' })).toBe(false)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: ['subassembly'] })).toBe(false)
    // Already finished_good: nothing to suggest.
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'finished_good' })).toBe(false)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: ['finished_good'] })).toBe(false)
  })

  it('(c) array-shaped and empty select values still read as unclassified', () => {
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: null })).toBe(true)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: '' })).toBe(true)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: [] })).toBe(true)
    expect(shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: [''] })).toBe(true)
  })

  it('(a) and (b) are unaffected by the widening: component alone is not enough', () => {
    expect(
      shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'component', hasProduct: false })
    ).toBe(false)
    expect(
      shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'component', isSubpartOfAssembly: true })
    ).toBe(false)
    expect(
      shouldSuggestFinishedGood({ ...ELIGIBLE, partKind: 'component', subpartCheckLoaded: false })
    ).toBe(false)
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

describe('isPartKindUnclassified', () => {
  it('agrees with isPartKindUnset on every unset shape', () => {
    for (const value of [undefined, null, '', [], ['']]) {
      expect(isPartKindUnset(value)).toBe(true)
      expect(isPartKindUnclassified(value)).toBe(true)
    }
  })

  it('adds `component`, the field default, so not a human choice', () => {
    expect(isPartKindUnset('component')).toBe(false)
    expect(isPartKindUnclassified('component')).toBe(true)
    expect(isPartKindUnclassified(['component'])).toBe(true)
  })

  it('leaves the two deliberate kinds classified', () => {
    expect(isPartKindUnclassified('subassembly')).toBe(false)
    expect(isPartKindUnclassified(['subassembly'])).toBe(false)
    expect(isPartKindUnclassified('finished_good')).toBe(false)
    expect(isPartKindUnclassified(['finished_good'])).toBe(false)
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

  it('is UNAFFECTED by the widened finished-good gate', () => {
    // The widening only moved `component` into the unclassified set.
    // shouldSuggestFamily gates on an explicit `finished_good`, which was never
    // in that set, so every answer here is exactly what it was before.
    for (const partKind of [
      undefined,
      null,
      '',
      [],
      [''],
      'component',
      ['component'],
      'subassembly',
    ]) {
      expect(shouldSuggestFamily({ hasProduct: false, partKind })).toBe(false)
    }
    expect(shouldSuggestFamily({ hasProduct: false, partKind: 'finished_good' })).toBe(true)
  })

  it('is mutually exclusive with the finished-good suggestion', () => {
    // The two gate on opposite sides of the same fact: one only speaks while
    // part_kind is unclassified, the other only once it says finished_good,
    // and finished_good is never unclassified. They also disagree on
    // hasProduct, so the exclusion is doubly true.
    const cases: Array<{ hasProduct: boolean; partKind: unknown }> = [
      { hasProduct: false, partKind: undefined },
      { hasProduct: false, partKind: 'finished_good' },
      { hasProduct: false, partKind: 'component' },
      { hasProduct: false, partKind: ['component'] },
      { hasProduct: false, partKind: 'subassembly' },
      { hasProduct: true, partKind: undefined },
      { hasProduct: true, partKind: 'finished_good' },
      { hasProduct: true, partKind: 'component' },
      { hasProduct: true, partKind: ['component'] },
      { hasProduct: true, partKind: 'subassembly' },
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

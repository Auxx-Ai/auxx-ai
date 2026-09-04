// packages/lib/src/record-layout/merge-block-order.test.ts

import { describe, expect, it } from 'vitest'
import { mergeBlockOrder } from './merge-block-order'

describe('mergeBlockOrder', () => {
  it('returns the baseline when nothing is stored', () => {
    expect(mergeBlockOrder({ baseline: ['a', 'b', 'c'], storedOrder: [] })).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing when the baseline is empty', () => {
    expect(mergeBlockOrder({ baseline: [], storedOrder: ['a', 'b'] })).toEqual([])
  })

  it('keeps the stored relative order for blocks that still exist', () => {
    expect(mergeBlockOrder({ baseline: ['a', 'b', 'c'], storedOrder: ['c', 'a', 'b'] })).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('drops ghosts, i.e. stored ids absent from the baseline', () => {
    expect(
      mergeBlockOrder({ baseline: ['a', 'b'], storedOrder: ['retired', 'b', 'a', 'gone'] })
    ).toEqual(['b', 'a'])
  })

  it('splices a NEW baseline id in at its registry-anchored position', () => {
    // `b` ships later. It must land after `a` (its registry predecessor), not at
    // the end of a strip the admin already rearranged.
    expect(mergeBlockOrder({ baseline: ['a', 'b', 'c'], storedOrder: ['c', 'a'] })).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('splices at the head when no stored predecessor qualifies', () => {
    expect(mergeBlockOrder({ baseline: ['new', 'a', 'b'], storedOrder: ['b', 'a'] })).toEqual([
      'new',
      'b',
      'a',
    ])
  })

  it('keeps several new ids in baseline order on a shared anchor', () => {
    expect(
      mergeBlockOrder({ baseline: ['a', 'n1', 'n2', 'n3', 'b'], storedOrder: ['b', 'a'] })
    ).toEqual(['b', 'a', 'n1', 'n2', 'n3'])
  })

  it('never lets a spliced-in id become an anchor itself', () => {
    // `n1` is spliced after `a`; `n2` must anchor on `a` too (the nearest STORED
    // predecessor), which is what keeps the pair in baseline order.
    const merged = mergeBlockOrder({ baseline: ['a', 'n1', 'n2'], storedOrder: ['a'] })
    expect(merged).toEqual(['a', 'n1', 'n2'])
  })

  it('does not anchor a new id on a block that was moved to another tab', () => {
    // `moved` sits inside another tab's run, so anchoring `new` on it would put
    // `new` on the wrong tab. It falls back to `a`.
    expect(
      mergeBlockOrder({
        baseline: ['a', 'moved', 'new', 'z'],
        storedOrder: ['a', 'z', 'moved'],
        isGrouped: (id) => id === 'moved',
      })
    ).toEqual(['a', 'new', 'z', 'moved'])
  })

  it('collapses duplicates in either input', () => {
    expect(
      mergeBlockOrder({ baseline: ['a', 'a', 'b'], storedOrder: ['b', 'b', 'a', 'a'] })
    ).toEqual(['b', 'a'])
  })

  it('is a fixpoint', () => {
    const baseline = ['a', 'b', 'c', 'd', 'e']
    const stored = ['e', 'retired', 'b']
    const once = mergeBlockOrder({ baseline, storedOrder: stored })
    const twice = mergeBlockOrder({ baseline, storedOrder: once })
    expect(twice).toEqual(once)
    expect([...once].sort()).toEqual([...baseline].sort())
  })

  it('is a fixpoint with the grouped guard applied', () => {
    const baseline = ['a', 'b', 'c', 'd']
    const isGrouped = (id: string) => id === 'c'
    const once = mergeBlockOrder({ baseline, storedOrder: ['d', 'a'], isGrouped })
    const twice = mergeBlockOrder({ baseline, storedOrder: once, isGrouped })
    expect(twice).toEqual(once)
  })
})

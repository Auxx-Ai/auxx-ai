// apps/web/src/components/fields/merge-field-order.test.ts
//
// The rule these tests pin down is the one thing that keeps `CustomField.sortOrder`
// meaningful after a view row exists. Every stored `panel` view in the dev DB
// carries a frozen, non-empty `fieldOrder`, so the merge path — not the
// no-stored-view path — is the normal one, and "append the leftovers" is what
// used to push every newly created field below the Created/Updated block.

import { describe, expect, it } from 'vitest'
import { mergeFieldOrder } from './merge-field-order'

const TRAILING = new Set(['id', 'createdAt', 'updatedAt', 'created_by_id'])
const isTrailing = (fieldId: string) => TRAILING.has(fieldId)

describe('mergeFieldOrder', () => {
  it('splices a new field at its baseline anchor instead of appending it', () => {
    // The plan's worked example (field-groups-and-view-ordering.md:198): stored
    // [A, C, B] (the user dragged C above B) and a new D whose BASELINE position
    // is between A and C. Walking back from D reaches A, so D lands after A.
    // Appending would give [A, C, B, D].
    expect(
      mergeFieldOrder({ baseline: ['A', 'D', 'B', 'C'], storedOrder: ['A', 'C', 'B'] })
    ).toEqual(['A', 'D', 'C', 'B'])
  })

  it('anchors on the nearest qualifying baseline predecessor, wherever it sits in the stored order', () => {
    // Same stored order, but D is now baseline-LAST, so its anchor is C — which
    // the user dragged into the middle. "Immediately after the anchor" is
    // resolved in the RESULT, not in the baseline, hence [A, C, D, B].
    expect(
      mergeFieldOrder({ baseline: ['A', 'B', 'C', 'D'], storedOrder: ['A', 'C', 'B'] })
    ).toEqual(['A', 'C', 'D', 'B'])
  })

  it('keeps the stored relative order of fields it already knows', () => {
    // A settings-side reorder of EXISTING fields must not reach a customised view.
    expect(mergeFieldOrder({ baseline: ['A', 'B', 'C'], storedOrder: ['C', 'A', 'B'] })).toEqual([
      'C',
      'A',
      'B',
    ])
  })

  it('drops stored ids that no longer exist in the baseline', () => {
    expect(mergeFieldOrder({ baseline: ['A', 'C'], storedOrder: ['A', 'ghost', 'C'] })).toEqual([
      'A',
      'C',
    ])
  })

  it('drops a ghost even when it would otherwise have been an anchor', () => {
    // `ghost` sits between A and N in nobody's baseline — it is gone, so N has
    // to fall back to A rather than trail a dead id.
    expect(mergeFieldOrder({ baseline: ['A', 'N'], storedOrder: ['A', 'ghost'] })).toEqual([
      'A',
      'N',
    ])
  })

  it('preserves baseline relative order among several new fields sharing an anchor', () => {
    expect(
      mergeFieldOrder({ baseline: ['A', 'N1', 'N2', 'N3', 'B'], storedOrder: ['A', 'B'] })
    ).toEqual(['A', 'N1', 'N2', 'N3', 'B'])
  })

  it('anchors each new field independently when they have different anchors', () => {
    expect(mergeFieldOrder({ baseline: ['A', 'N1', 'B', 'N2'], storedOrder: ['B', 'A'] })).toEqual([
      'B',
      'N2',
      'A',
      'N1',
    ])
  })

  it('skips trailing metadata when picking an anchor, so a new field lands above the block', () => {
    expect(
      mergeFieldOrder({
        baseline: ['A', 'createdAt', 'updatedAt', 'N'],
        storedOrder: ['A', 'createdAt', 'updatedAt'],
        isTrailing,
      })
    ).toEqual(['A', 'N', 'createdAt', 'updatedAt'])
  })

  it('falls back to the head when every stored predecessor is trailing metadata', () => {
    expect(
      mergeFieldOrder({
        baseline: ['createdAt', 'updatedAt', 'N'],
        storedOrder: ['createdAt', 'updatedAt'],
        isTrailing,
      })
    ).toEqual(['N', 'createdAt', 'updatedAt'])
  })

  it('would have anchored on trailing metadata without the guard (guard is load-bearing)', () => {
    // Same inputs as the previous test minus `isTrailing`: the user-dragged
    // metadata field is then a perfectly valid anchor and the new field lands
    // inside the trailing block.
    expect(
      mergeFieldOrder({
        baseline: ['createdAt', 'updatedAt', 'N'],
        storedOrder: ['createdAt', 'updatedAt'],
      })
    ).toEqual(['createdAt', 'updatedAt', 'N'])
  })

  it('lets a NEW trailing field join the end of the trailing block', () => {
    // The trailing guard exists to keep business fields above the metadata
    // block. Applying it to a trailing field being placed would push it above
    // the very block it belongs to — the case of a view predating `created_by_id`.
    expect(
      mergeFieldOrder({
        baseline: ['A', 'B', 'createdAt', 'updatedAt', 'created_by_id'],
        storedOrder: ['A', 'B', 'createdAt', 'updatedAt'],
        isTrailing,
      })
    ).toEqual(['A', 'B', 'createdAt', 'updatedAt', 'created_by_id'])
  })

  it('anchors a new trailing field on the block wherever the user dragged the block to', () => {
    // Stored order wins for existing fields, so the "block" can sit mid-list.
    // The new metadata field follows it rather than the baseline tail.
    expect(
      mergeFieldOrder({
        baseline: ['A', 'B', 'createdAt', 'updatedAt', 'created_by_id'],
        storedOrder: ['createdAt', 'updatedAt', 'A', 'B'],
        isTrailing,
      })
    ).toEqual(['createdAt', 'updatedAt', 'created_by_id', 'A', 'B'])
  })

  it('falls through to the normal path for a new trailing field when no trailing field is stored', () => {
    expect(
      mergeFieldOrder({
        baseline: ['A', 'B', 'created_by_id'],
        storedOrder: ['A', 'B'],
        isTrailing,
      })
    ).toEqual(['A', 'B', 'created_by_id'])
  })

  it('still keeps a new trailing field out of a group (the group guard has no exemption)', () => {
    const grouped = new Set(['G'])
    expect(
      mergeFieldOrder({
        baseline: ['A', 'G', 'created_by_id'],
        storedOrder: ['A', 'G'],
        isTrailing,
        isGrouped: (id) => grouped.has(id),
      })
    ).toEqual(['A', 'created_by_id', 'G'])
  })

  it('skips grouped fields when picking an anchor, so a new field never lands inside a group', () => {
    const grouped = new Set(['G1', 'G2'])
    expect(
      mergeFieldOrder({
        baseline: ['A', 'G1', 'G2', 'N'],
        storedOrder: ['A', 'G1', 'G2'],
        isGrouped: (id) => grouped.has(id),
      })
    ).toEqual(['A', 'N', 'G1', 'G2'])
  })

  it('skips past both grouped and trailing candidates in one walk', () => {
    const grouped = new Set(['G'])
    expect(
      mergeFieldOrder({
        baseline: ['A', 'G', 'updatedAt', 'N'],
        storedOrder: ['A', 'G', 'updatedAt'],
        isTrailing,
        isGrouped: (id) => grouped.has(id),
      })
    ).toEqual(['A', 'N', 'G', 'updatedAt'])
  })

  it('returns the baseline unchanged for an empty stored order', () => {
    expect(mergeFieldOrder({ baseline: ['A', 'B', 'C'], storedOrder: [] })).toEqual(['A', 'B', 'C'])
  })

  it('returns the baseline when the stored order is nothing but ghosts', () => {
    expect(mergeFieldOrder({ baseline: ['A', 'B'], storedOrder: ['x', 'y'] })).toEqual(['A', 'B'])
  })

  it('returns [] for an empty baseline, ghosts and all', () => {
    expect(mergeFieldOrder({ baseline: [], storedOrder: ['A', 'B'] })).toEqual([])
    expect(mergeFieldOrder({ baseline: [], storedOrder: [] })).toEqual([])
  })

  it('collapses duplicates in either input', () => {
    expect(mergeFieldOrder({ baseline: ['A', 'A', 'B'], storedOrder: ['B', 'A', 'B'] })).toEqual([
      'B',
      'A',
    ])
  })

  it('is a fixpoint — re-merging its own output changes nothing', () => {
    // The merged order is what gets persisted, so a second pass over a saved
    // result must be inert or the view would drift on every read/save cycle.
    const grouped = new Set(['G1'])
    const cases: Array<{ baseline: string[]; storedOrder: string[] }> = [
      { baseline: ['A', 'B', 'C', 'D'], storedOrder: ['A', 'C', 'B'] },
      { baseline: ['A', 'N1', 'N2', 'B'], storedOrder: ['B', 'A'] },
      { baseline: ['A', 'G1', 'createdAt', 'N'], storedOrder: ['A', 'G1', 'createdAt', 'gone'] },
      { baseline: ['A', 'B'], storedOrder: [] },
      { baseline: ['createdAt', 'updatedAt', 'N'], storedOrder: ['createdAt', 'updatedAt'] },
      // A new TRAILING field joining the block — the branch that treats the
      // placed field's own trailing-ness as an exemption must not oscillate.
      {
        baseline: ['A', 'createdAt', 'updatedAt', 'created_by_id'],
        storedOrder: ['A', 'createdAt', 'updatedAt'],
      },
      {
        baseline: ['A', 'G1', 'N', 'createdAt', 'created_by_id'],
        storedOrder: ['createdAt', 'A', 'G1'],
      },
    ]

    for (const { baseline, storedOrder } of cases) {
      const once = mergeFieldOrder({
        baseline,
        storedOrder,
        isTrailing,
        isGrouped: (id) => grouped.has(id),
      })
      const twice = mergeFieldOrder({
        baseline,
        storedOrder: once,
        isTrailing,
        isGrouped: (id) => grouped.has(id),
      })
      expect(twice).toEqual(once)
    }
  })

  it('always returns exactly the baseline id set', () => {
    const baseline = ['A', 'B', 'C', 'D', 'createdAt']
    const merged = mergeFieldOrder({
      baseline,
      storedOrder: ['C', 'gone', 'A', 'createdAt'],
      isTrailing,
    })
    expect([...merged].sort()).toEqual([...baseline].sort())
  })

  it('does not mutate its inputs', () => {
    const baseline = ['A', 'B', 'C']
    const storedOrder = ['C', 'A']
    mergeFieldOrder({ baseline, storedOrder })
    expect(baseline).toEqual(['A', 'B', 'C'])
    expect(storedOrder).toEqual(['C', 'A'])
  })
})

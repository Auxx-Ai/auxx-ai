// packages/lib/src/data-connectors/sinks/entity-sink-merge-pending.test.ts
// Unit tests for the pending-relation merge semantics that back clear-on-empty
// (plan §5.7): last-wins-by-fieldKey + the drop-clear-if-not-linked guard.

import { describe, expect, it } from 'vitest'
import type { PendingRelation } from '../service'
import { mergePending } from './entity-sink'

const set = (fieldKey: string, targetDef: string, targetExternalId: string): PendingRelation => ({
  fieldKey,
  targetDef,
  targetExternalId,
})
const clear = (fieldKey: string): PendingRelation => ({
  fieldKey,
  targetDef: null,
  targetExternalId: null,
})

describe('mergePending', () => {
  it('keeps a single set edge', () => {
    expect(mergePending([], [set('customer', 'm', 'c1')], new Set())).toEqual([
      set('customer', 'm', 'c1'),
    ])
  })

  it('last-wins by fieldKey — a changed set supersedes the stale one', () => {
    const out = mergePending([set('customer', 'm', 'c1')], [set('customer', 'm', 'c2')], new Set())
    expect(out).toEqual([set('customer', 'm', 'c2')])
  })

  it('keeps distinct fieldKeys side by side', () => {
    const out = mergePending([set('customer', 'm', 'c1')], [set('company', 'm2', 'co1')], new Set())
    expect(out).toHaveLength(2)
  })

  it('drops a clear whose field has no live edge — and discards an abandoned pending set', () => {
    // Set in run 1 never resolved (linkedRelations empty), FK empties in run 2:
    // the clear supersedes the abandoned set and is itself dropped → no edge.
    const out = mergePending([set('customer', 'm', 'c1')], [clear('customer')], new Set())
    expect(out).toEqual([])
  })

  it('keeps a clear when the field has a live edge (it will be applied + cleared)', () => {
    const out = mergePending([], [clear('customer')], new Set(['customer']))
    expect(out).toEqual([clear('customer')])
  })

  it('a clear supersedes a stale pending set when the field is live', () => {
    const out = mergePending(
      [set('customer', 'm', 'c1')],
      [clear('customer')],
      new Set(['customer'])
    )
    expect(out).toEqual([clear('customer')])
  })

  it('a fresh set supersedes a pending clear (re-link before the clear is applied)', () => {
    const out = mergePending([clear('customer')], [set('customer', 'm', 'c2')], new Set())
    expect(out).toEqual([set('customer', 'm', 'c2')])
  })
})

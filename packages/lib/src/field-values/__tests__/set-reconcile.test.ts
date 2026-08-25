// packages/lib/src/field-values/__tests__/set-reconcile.test.ts
//
// Pure unit tests for the set-write diff (plans/field-values/
// delete-insert-replace.md §5B): no DB, no mocks — planSetReconcile is a
// function of (stored rows, target rows). The DB-backed behavior of the plan
// (row identity over time, marker transitions, key compaction) is pinned in
// set-reconcile.int.test.ts and write-idempotency-stamps.int.test.ts.

import { describe, expect, it } from 'vitest'
import {
  type FieldValueInsertRow,
  MAX_SANE_SORT_KEY_LENGTH,
  planSetReconcile,
  type StoredSetRow,
} from '../set-reconcile'

const BASE = {
  organizationId: 'org-1',
  entityId: 'inst-1',
  entityDefinitionId: 'widget',
  fieldId: 'field-1',
}

function stored(id: string, sortKey: string, payload: Partial<StoredSetRow> = {}): StoredSetRow {
  return {
    id,
    sortKey,
    aiStatus: null,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    ...payload,
  }
}

function target(sortKey: string, payload: Partial<FieldValueInsertRow> = {}): FieldValueInsertRow {
  return {
    ...BASE,
    sortKey,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    ...payload,
  } as FieldValueInsertRow
}

function diffOf(plan: ReturnType<typeof planSetReconcile>) {
  if (plan.kind !== 'diff') throw new Error(`expected diff, got ${plan.kind}`)
  return plan
}

describe('planSetReconcile', () => {
  it('identical lists plan zero statements', () => {
    const rows = [stored('r1', 'a0', { valueText: 'x' }), stored('r2', 'a1', { valueText: 'y' })]
    const plan = diffOf(
      planSetReconcile(rows, [target('a0', { valueText: 'x' }), target('a1', { valueText: 'y' })])
    )
    expect(plan.keep.map((k) => k.row.id)).toEqual(['r1', 'r2'])
    expect(plan.update).toHaveLength(0)
    expect(plan.insertTail).toHaveLength(0)
    expect(plan.deleteIds).toHaveLength(0)
  })

  it('a single edit updates exactly that position', () => {
    const rows = [stored('r1', 'a0', { valueText: 'x' }), stored('r2', 'a1', { valueText: 'y' })]
    const plan = diffOf(
      planSetReconcile(rows, [
        target('a0', { valueText: 'x' }),
        target('a1', { valueText: 'CHANGED' }),
      ])
    )
    expect(plan.keep.map((k) => k.position)).toEqual([0])
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]!.position).toBe(1)
    expect(plan.update[0]!.row.id).toBe('r2')
    expect(plan.insertTail).toHaveLength(0)
    expect(plan.deleteIds).toHaveLength(0)
  })

  it('append inserts a tail keyed after the last surviving key', () => {
    const rows = [stored('r1', 'a0', { valueText: 'x' })]
    const plan = diffOf(
      planSetReconcile(rows, [target('zz', { valueText: 'x' }), target('zz', { valueText: 'new' })])
    )
    expect(plan.keep).toHaveLength(1)
    expect(plan.update).toHaveLength(0)
    expect(plan.insertTail).toHaveLength(1)
    // The minted tail key sorts after the SURVIVING row's stored key — the
    // target's own (canonical) key is discarded.
    expect(plan.insertTail[0]!.sortKey! > 'a0').toBe(true)
    expect(plan.deleteIds).toHaveLength(0)
  })

  it('shrink deletes exactly the stored tail', () => {
    const rows = [
      stored('r1', 'a0', { valueText: 'x' }),
      stored('r2', 'a1', { valueText: 'y' }),
      stored('r3', 'a2', { valueText: 'z' }),
    ]
    const plan = diffOf(planSetReconcile(rows, [target('a0', { valueText: 'x' })]))
    expect(plan.keep.map((k) => k.row.id)).toEqual(['r1'])
    expect(plan.update).toHaveLength(0)
    expect(plan.deleteIds).toEqual(['r2', 'r3'])
  })

  it('an empty target plans a pure delete (clear)', () => {
    const rows = [stored('r1', 'a0', { valueText: 'x' }), stored('r2', 'a1', { valueText: 'y' })]
    const plan = diffOf(planSetReconcile(rows, []))
    expect(plan.keep).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.insertTail).toHaveLength(0)
    expect(plan.deleteIds).toEqual(['r1', 'r2'])
  })

  it('a reorder rewrites payloads into surviving rows — ids stay positional', () => {
    const rows = [stored('r1', 'a0', { valueText: 'x' }), stored('r2', 'a1', { valueText: 'y' })]
    const plan = diffOf(
      planSetReconcile(rows, [target('a0', { valueText: 'y' }), target('a1', { valueText: 'x' })])
    )
    expect(plan.keep).toHaveLength(0)
    expect(plan.update.map((u) => [u.row.id, u.target.valueText])).toEqual([
      ['r1', 'y'],
      ['r2', 'x'],
    ])
  })

  it('marker-only difference is an update, both directions', () => {
    // Manual write over a row carrying an AI marker: identical payload, but
    // the marker must clear in place.
    const marked = [stored('r1', 'a0', { valueText: 'x', aiStatus: 'result' })]
    const clearPlan = diffOf(planSetReconcile(marked, [target('a0', { valueText: 'x' })]))
    expect(clearPlan.update).toHaveLength(1)
    expect(clearPlan.update[0]!.target.aiStatus ?? null).toBeNull()

    // AI stage-2 over an unmarked identical payload: the row must gain the marker.
    const plain = [stored('r1', 'a0', { valueText: 'x' })]
    const markPlan = diffOf(
      planSetReconcile(plain, [target('a0', { valueText: 'x', aiStatus: 'result' })])
    )
    expect(markPlan.update).toHaveLength(1)
    expect(markPlan.keep).toHaveLength(0)
  })

  it('an invalid stored key falls back to rewrite', () => {
    const rows = [stored('r1', '', { valueText: 'x' })]
    expect(planSetReconcile(rows, [target('a0', { valueText: 'x' })])).toEqual({
      kind: 'rewrite',
      reason: 'invalid-key',
    })
  })

  it('a key grown past the sanity length falls back to rewrite', () => {
    const grown = `a${'V'.repeat(MAX_SANE_SORT_KEY_LENGTH)}`
    const rows = [stored('r1', grown, { valueText: 'x' })]
    expect(planSetReconcile(rows, [target('a0', { valueText: 'x' })])).toEqual({
      kind: 'rewrite',
      reason: 'grown-key',
    })
  })

  it('disordered stored keys fall back to rewrite', () => {
    const rows = [stored('r1', 'a1', { valueText: 'x' }), stored('r2', 'a0', { valueText: 'y' })]
    expect(planSetReconcile(rows, [target('a0', { valueText: 'x' })])).toEqual({
      kind: 'rewrite',
      reason: 'disordered-keys',
    })
  })

  it('empty stored + non-empty target is an all-insert with the targets own keys', () => {
    const plan = diffOf(
      planSetReconcile([], [target('a0', { valueText: 'x' }), target('a1', { valueText: 'y' })])
    )
    expect(plan.keep).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.deleteIds).toHaveLength(0)
    expect(plan.insertTail.map((r) => r.sortKey)).toEqual(['a0', 'a1'])
  })
})

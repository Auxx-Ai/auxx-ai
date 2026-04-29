// packages/lib/src/approvals/__tests__/temp-id.test.ts

import { describe, expect, it } from 'vitest'
import {
  assertNoUnresolvedTempIds,
  collectTempDeps,
  substituteTempIds,
  topoSortActions,
} from '../temp-id'
import type { ProposedAction } from '../types'

const action = (
  localIndex: number,
  args: Record<string, unknown>,
  toolName = 'tool'
): ProposedAction => ({
  localIndex,
  toolName,
  args,
  summary: `${toolName}/${localIndex}`,
})

describe('collectTempDeps', () => {
  it('finds top-level temp id refs', () => {
    expect(collectTempDeps({ id: 'temp_3', name: 'x' })).toEqual(new Set([3]))
  })

  it('finds temp ids inside nested objects and arrays', () => {
    const deps = collectTempDeps({
      a: { b: { c: 'temp_0' } },
      list: ['temp_2', { nested: 'temp_5' }],
      keepLast: 'literal',
    })
    expect(deps).toEqual(new Set([0, 2, 5]))
  })

  it('does NOT match substring temp ids inside prose', () => {
    expect(collectTempDeps({ note: 'please review temp_3 first' })).toEqual(new Set())
  })

  it('handles null / undefined / non-strings', () => {
    expect(collectTempDeps({ a: null, b: undefined, c: 5, d: false })).toEqual(new Set())
  })
})

describe('topoSortActions', () => {
  it('orders parent before child', () => {
    const a = action(0, { title: 'x' })
    const b = action(1, { id: 'temp_0' })
    const sorted = topoSortActions([b, a])
    expect(sorted.map((s) => s.localIndex)).toEqual([0, 1])
  })

  it('preserves localIndex order between independent actions', () => {
    const a = action(0, {})
    const b = action(1, {})
    const c = action(2, {})
    const sorted = topoSortActions([c, a, b])
    expect(sorted.map((s) => s.localIndex)).toEqual([0, 1, 2])
  })

  it('orders a fan-out: parent first, all children after', () => {
    const a = action(0, {})
    const b = action(1, { parent: 'temp_0' })
    const c = action(2, { parent: 'temp_0' })
    const sorted = topoSortActions([c, b, a])
    expect(sorted[0]?.localIndex).toBe(0)
    expect(new Set(sorted.slice(1).map((s) => s.localIndex))).toEqual(new Set([1, 2]))
  })

  it('throws on a cycle (sanity check; the engine should never produce one)', () => {
    const a = action(0, { ref: 'temp_1' })
    const b = action(1, { ref: 'temp_0' })
    expect(() => topoSortActions([a, b])).toThrow(/Cycle detected/)
  })
})

describe('substituteTempIds', () => {
  it('replaces top-level matching strings', () => {
    const out = substituteTempIds({ id: 'temp_0', name: 'x' }, new Map([['temp_0', 'real-1']]))
    expect(out).toEqual({ id: 'real-1', name: 'x' })
  })

  it('replaces nested temp ids and leaves unrelated leaves untouched', () => {
    const subs = new Map([
      ['temp_0', 'real-1'],
      ['temp_3', 'real-2'],
    ])
    const out = substituteTempIds(
      {
        a: 'temp_0',
        b: { c: { d: 'temp_3' } },
        list: ['temp_0', 'literal', 'temp_3'],
      },
      subs
    )
    expect(out).toEqual({
      a: 'real-1',
      b: { c: { d: 'real-2' } },
      list: ['real-1', 'literal', 'real-2'],
    })
  })

  it('does not mutate the input', () => {
    const input = { id: 'temp_0' }
    substituteTempIds(input, new Map([['temp_0', 'real']]))
    expect(input.id).toBe('temp_0')
  })

  it('leaves unmapped temp ids in place', () => {
    const out = substituteTempIds({ id: 'temp_99' }, new Map())
    expect(out).toEqual({ id: 'temp_99' })
  })
})

describe('assertNoUnresolvedTempIds', () => {
  it('passes when no temp ids remain', () => {
    expect(() => assertNoUnresolvedTempIds({ a: 'real-1', b: ['x', { c: 5 }] })).not.toThrow()
  })

  it('throws on a leftover top-level temp id', () => {
    expect(() => assertNoUnresolvedTempIds({ id: 'temp_3' })).toThrow(/Unresolved temp id/)
  })

  it('throws on a leftover nested temp id', () => {
    expect(() => assertNoUnresolvedTempIds({ a: { b: { c: 'temp_7' } } })).toThrow(
      /Unresolved temp id/
    )
  })

  it('does NOT throw for prose containing the substring `temp_3`', () => {
    // We only match the WHOLE leaf string — substrings are intentional
    // (otherwise legitimate prose like "review temp_3 first" would fail).
    expect(() => assertNoUnresolvedTempIds({ note: 'please review temp_3 first' })).not.toThrow()
  })
})

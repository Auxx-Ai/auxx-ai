// packages/lib/src/evals/__tests__/comparators.test.ts

import type { Comparator } from '@auxx/types/evals'
import { describe, expect, it } from 'vitest'
import { evaluateComparator, MISSING } from '../comparators'

// `deepEqual` itself now lives in `@auxx/utils/objects` and is covered there
// (key-order independence, array order, Date, symbol/MISSING vs null). These
// tests exercise only the eval-domain comparator semantics layered on top.

describe('evaluateComparator', () => {
  const op = (o: Comparator['op'], tolerance?: number) =>
    (tolerance !== undefined ? { op: o, tolerance } : { op: o }) as Comparator

  it('exists distinguishes MISSING from a present null', () => {
    expect(evaluateComparator(op('exists'), null).passed).toBe(true)
    expect(evaluateComparator(op('exists'), MISSING).passed).toBe(false)
    expect(evaluateComparator(op('not_exists'), MISSING).passed).toBe(true)
    expect(evaluateComparator(op('not_exists'), null).passed).toBe(false)
  })

  it('equals / not_equals use deep equality', () => {
    expect(evaluateComparator(op('equals'), { a: 1 }, { a: 1 }).passed).toBe(true)
    expect(evaluateComparator(op('not_equals'), { a: 1 }, { a: 2 }).passed).toBe(true)
  })

  it('contains handles strings and arrays', () => {
    expect(evaluateComparator(op('contains'), 'hello world', 'world').passed).toBe(true)
    expect(evaluateComparator(op('contains'), ['a', 'b'], 'b').passed).toBe(true)
    expect(evaluateComparator(op('contains'), ['a', 'b'], 'z').passed).toBe(false)
    expect(evaluateComparator(op('contains'), 42, 'z').passed).toBe(false)
  })

  it('numeric comparators respect ordering and tolerance', () => {
    expect(evaluateComparator(op('gt'), 5, 3).passed).toBe(true)
    expect(evaluateComparator(op('lte'), 3, 3).passed).toBe(true)
    // 2 is below 3, but a tolerance of 1 loosens the gte boundary to >= 2.
    expect(evaluateComparator(op('gte', 1), 2, 3).passed).toBe(true)
    expect(evaluateComparator(op('gte'), 2, 3).passed).toBe(false)
  })

  it('numeric comparators treat ISO dates as epoch ms', () => {
    expect(
      evaluateComparator(op('gt'), '2026-06-08T00:00:00Z', '2026-01-01T00:00:00Z').passed
    ).toBe(true)
  })

  it('errors (passed=false + note) on non-numeric inputs', () => {
    const r = evaluateComparator(op('gt'), 'not-a-number', 3)
    expect(r.passed).toBe(false)
    expect(r.note).toBeDefined()
  })
})

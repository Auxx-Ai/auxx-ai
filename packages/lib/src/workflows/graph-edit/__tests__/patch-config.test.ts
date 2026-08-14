// packages/lib/src/workflows/graph-edit/__tests__/patch-config.test.ts

import { describe, expect, it } from 'vitest'
import { applyConfigPatches } from '../patch-config'

describe('applyConfigPatches', () => {
  it('sets nested objects, dynamic dotted keys, and array leaves without losing siblings', () => {
    const original = {
      model: { completion_params: { temperature: 0.7, max_tokens: 500 } },
      schema: { properties: {} as Record<string, unknown> },
      cases: [{ id: 'case-1', logical_operator: 'and' }],
    }
    const result = applyConfigPatches(original, [
      { op: 'set', path: ['model', 'completion_params', 'temperature'], value: 0.2 },
      { op: 'set', path: ['schema', 'properties', 'order.total'], value: { type: 'number' } },
      { op: 'set', path: ['cases', 0, 'logical_operator'], value: 'or' },
    ])

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      model: { completion_params: { temperature: 0.2, max_tokens: 500 } },
      schema: { properties: { 'order.total': { type: 'number' } } },
      cases: [{ id: 'case-1', logical_operator: 'or' }],
    })
    expect(original.model.completion_params.temperature).toBe(0.7)
  })

  it('creates and removes optional object fields in one atomic patch set', () => {
    const result = applyConfigPatches({ authorization: { type: 'bearer' } }, [
      { op: 'set', path: ['authorization', 'token'], value: 'secret' },
      { op: 'unset', path: ['authorization', 'token'] },
    ])

    expect(result._unsafeUnwrap()).toEqual({ authorization: { type: 'bearer' } })
  })

  it.each([
    [{ op: 'set', path: ['missing', 'child'], value: true }],
    [{ op: 'set', path: ['items', 1], value: 'b' }],
    [{ op: 'unset', path: ['items', 0] }],
    [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
    [{ op: 'set', path: ['_targetBranches'], value: [] }],
    [{ op: 'set', path: ['id'], value: 'evil' }],
  ])('rejects unsafe or ambiguous path operations: %j', (patch) => {
    const result = applyConfigPatches({ items: ['a'] }, [patch] as Parameters<
      typeof applyConfigPatches
    >[1])
    expect(result.isErr()).toBe(true)
  })

  it('does not mutate the input when a later patch fails', () => {
    const original = { nested: { value: 1 } }
    const result = applyConfigPatches(original, [
      { op: 'set', path: ['nested', 'value'], value: 2 },
      { op: 'set', path: ['nested', 'missing', 'value'], value: 3 },
    ])

    expect(result.isErr()).toBe(true)
    expect(original).toEqual({ nested: { value: 1 } })
  })
})

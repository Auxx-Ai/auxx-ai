// packages/utils/src/__tests__/objects.test.ts

import { describe, expect, it } from 'vitest'
import { deepEqual } from '../objects'

describe('deepEqual', () => {
  it('compares object keys order-independently', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('compares arrays order-sensitively', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
  })

  it('recurses through nested arrays and objects', () => {
    expect(deepEqual({ a: [{ x: 1 }] }, { a: [{ x: 1 }] })).toBe(true)
    expect(deepEqual({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toBe(false)
  })

  it('compares Dates by timestamp', () => {
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true)
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false)
    expect(deepEqual(new Date('2024-01-01'), { foo: 1 })).toBe(false)
  })

  it('treats undefined and a missing key as distinct from null', () => {
    expect(deepEqual(undefined, null)).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual({ a: undefined }, {})).toBe(false)
  })

  it('distinguishes arrays from non-array objects', () => {
    expect(deepEqual([], {})).toBe(false)
  })

  it('compares symbols by identity', () => {
    const s = Symbol('x')
    expect(deepEqual(s, s)).toBe(true)
    expect(deepEqual(s, Symbol('x'))).toBe(false)
    expect(deepEqual(s, null)).toBe(false)
  })
})

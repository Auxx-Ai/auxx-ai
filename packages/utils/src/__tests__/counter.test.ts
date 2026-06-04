// packages/utils/src/__tests__/counter.test.ts

import { describe, expect, it } from 'vitest'
import { createCounter, createIdAllocator } from '../counter'

describe('createCounter', () => {
  it('starts at 1 by default and increments monotonically', () => {
    const next = createCounter()
    expect(next()).toBe(1)
    expect(next()).toBe(2)
    expect(next()).toBe(3)
  })

  it('emits start + 1 first when seeded', () => {
    const next = createCounter(10)
    expect(next()).toBe(11)
    expect(next()).toBe(12)
  })

  it('keeps separate counters independent', () => {
    const a = createCounter()
    const b = createCounter(100)
    expect(a()).toBe(1)
    expect(b()).toBe(101)
    expect(a()).toBe(2)
  })
})

describe('createIdAllocator', () => {
  it('prefixes sequential ids', () => {
    const next = createIdAllocator('b')
    expect(next()).toBe('b1')
    expect(next()).toBe('b2')
  })

  it('seeds above an existing max', () => {
    const next = createIdAllocator('b', 4)
    expect(next()).toBe('b5')
    expect(next()).toBe('b6')
  })

  it('defaults to a bare numeric string with no prefix', () => {
    const next = createIdAllocator()
    expect(next()).toBe('1')
    expect(next()).toBe('2')
  })
})

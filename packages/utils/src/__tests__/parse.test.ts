// packages/utils/src/__tests__/parse.test.ts

import { describe, expect, it } from 'vitest'
import { parseBoolean, toNumeric } from '../parse'

describe('parseBoolean', () => {
  it('coerces truthy and falsy tokens', () => {
    expect(parseBoolean('yes')).toBe(true)
    expect(parseBoolean('0')).toBe(false)
    expect(parseBoolean(true)).toBe(true)
  })

  it('returns undefined for unknown input', () => {
    expect(parseBoolean(null)).toBeUndefined()
    expect(parseBoolean('maybe')).toBeUndefined()
  })
})

describe('toNumeric', () => {
  it('passes numbers through, rejecting NaN', () => {
    expect(toNumeric(42)).toBe(42)
    expect(toNumeric(Number.NaN)).toBeNull()
  })

  it('parses ISO date strings to epoch ms', () => {
    expect(toNumeric('2024-01-01T00:00:00.000Z')).toBe(Date.parse('2024-01-01T00:00:00.000Z'))
  })

  it('falls back to Number only for strings Date.parse rejects', () => {
    // Date.parse is greedy: bare decimals/integers are interpreted as dates first.
    expect(toNumeric('3.5')).toBe(Date.parse('3.5'))
    // Exotic numeric formats Date.parse cannot read fall through to Number.
    expect(toNumeric('1e3')).toBe(1000)
  })

  it('returns null for empty or non-numeric strings and other types', () => {
    expect(toNumeric('')).toBeNull()
    expect(toNumeric('   ')).toBeNull()
    expect(toNumeric('hello')).toBeNull()
    expect(toNumeric(null)).toBeNull()
    expect(toNumeric({})).toBeNull()
  })
})

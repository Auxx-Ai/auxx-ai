// packages/utils/src/__tests__/json.test.ts

import { describe, expect, it } from 'vitest'
import { bigIntReplacer, safeJsonParse, safeJsonStringify } from '../json'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('returns undefined on invalid JSON', () => {
    expect(safeJsonParse('{ not json')).toBeUndefined()
    expect(safeJsonParse('')).toBeUndefined()
  })

  it('returns the provided fallback on invalid JSON', () => {
    expect(safeJsonParse('nope', null)).toBeNull()
    expect(safeJsonParse('nope', { ok: false })).toEqual({ ok: false })
  })
})

describe('safeJsonStringify', () => {
  it('renders BigInt as a string instead of throwing', () => {
    expect(safeJsonStringify({ id: 9007199254740993n })).toBe('{"id":"9007199254740993"}')
  })

  it('honors the space arg for pretty-printing', () => {
    expect(safeJsonStringify({ a: 1 }, 2)).toBe('{\n  "a": 1\n}')
  })
})

describe('bigIntReplacer', () => {
  it('stringifies bigint and passes everything else through', () => {
    expect(bigIntReplacer('k', 5n)).toBe('5')
    expect(bigIntReplacer('k', 'x')).toBe('x')
    expect(bigIntReplacer('k', 42)).toBe(42)
  })
})

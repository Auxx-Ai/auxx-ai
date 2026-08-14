// packages/lib/src/import/__tests__/split-resolvers.test.ts

import { describe, expect, it } from 'vitest'
import {
  resolveEmailSplit,
  resolvePhoneSplit,
  resolveUrlSplit,
  splitMultiValueCell,
} from '../resolution/resolvers/split'

describe('splitMultiValueCell', () => {
  it('splits on comma and semicolon, trims, drops empties', () => {
    expect(splitMultiValueCell('a@x.com, b@y.com;c@z.com , ,')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ])
  })
})

describe('resolveEmailSplit', () => {
  it('resolves a comma cell into two normalized values', () => {
    const result = resolveEmailSplit('A@X.com, b@y.com', {})
    expect(result.type).toBe('value')
    expect(result.value).toEqual(['a@x.com', 'b@y.com'])
  })

  it('dedupes case-insensitively', () => {
    const result = resolveEmailSplit('a@x.com; A@X.COM, b@y.com', {})
    expect(result.value).toEqual(['a@x.com', 'b@y.com'])
  })

  it('drops an invalid element with a warning and keeps the rest', () => {
    const result = resolveEmailSplit('a@x.com, not-an-email', {})
    expect(result.type).toBe('warning')
    expect(result.value).toEqual(['a@x.com'])
    expect(result.warning).toContain('not-an-email')
  })

  it('errors when every element is invalid', () => {
    const result = resolveEmailSplit('nope, also-nope', {})
    expect(result.type).toBe('error')
    expect(result.error).toBeDefined()
  })

  it('honors the 10-value cap with a warning', () => {
    const cell = Array.from({ length: 12 }, (_, i) => `u${i}@x.com`).join(', ')
    const result = resolveEmailSplit(cell, {})
    expect(result.type).toBe('warning')
    expect(result.value).toHaveLength(10)
    expect(result.warning).toContain('limit')
  })

  it('resolves a blank cell to null (no-write on update rows)', () => {
    const result = resolveEmailSplit('  ', {})
    expect(result).toEqual({ type: 'value', value: null })
  })
})

describe('resolvePhoneSplit', () => {
  it('normalizes each element to E.164', () => {
    const result = resolvePhoneSplit('+1 (415) 555-1234; 212 555 0100', {})
    expect(result.type).toBe('value')
    expect(result.value).toEqual(['+14155551234', '+12125550100'])
  })

  it('mixes international and national elements', () => {
    const result = resolvePhoneSplit('+49 30 901820, (415) 555-1234', {})
    expect(result.type).toBe('value')
    expect(result.value).toEqual(['+4930901820', '+14155551234'])
  })

  it('drops an invalid element with a warning', () => {
    const result = resolvePhoneSplit('(415) 555-1234, 12345', {})
    expect(result.type).toBe('warning')
    expect(result.value).toEqual(['+14155551234'])
  })
})

describe('resolveUrlSplit', () => {
  it('prefixes https:// and lowercases like the write path', () => {
    const result = resolveUrlSplit('Example.com, https://foo.io/path', {})
    expect(result.type).toBe('value')
    expect(result.value).toEqual(['https://example.com', 'https://foo.io/path'])
  })

  it('drops an unparseable element with a warning', () => {
    const result = resolveUrlSplit('example.com, not a url at all', {})
    expect(result.type).toBe('warning')
    expect(result.value).toEqual(['https://example.com'])
  })
})

describe('export → import round trip', () => {
  it('is lossless for a multi-email contact (export joins ", ", split trims)', () => {
    const stored = ['a@x.com', 'b@y.com', 'c+alias@z.dev']
    // CSV export joins multi-value display arrays with ', ' (format-cell.ts)
    const exportedCell = stored.join(', ')
    const reimported = resolveEmailSplit(exportedCell, {})
    expect(reimported.type).toBe('value')
    expect(reimported.value).toEqual(stored)
  })
})

// packages/lib/src/workflow-engine/catalog/variable-inference.test.ts

import { describe, expect, it } from 'vitest'
import {
  parseArraySegmentsFromId,
  parseVariablePath,
  setSegmentAccessor,
} from './variable-inference'

/**
 * Unit tests for the segment-walk resolver's parser (see
 * `plans/kopilot/workflow/11-segment-walk-resolver.md` §2/§8). Grammar:
 *   path    := segment ("." segment)*
 *   segment := key bracket?
 *   bracket := "[" ("*" | "-"? digit+) "]"
 * Structural characters are ONLY "." and one trailing "[...]" per segment —
 * everything else (spaces, "&", "/") is a legal key character.
 */
describe('parseVariablePath', () => {
  it('parses a plain dotted path with no brackets', () => {
    expect(parseVariablePath('webhook-123.body.contact.email')).toEqual([
      { key: 'webhook-123' },
      { key: 'body' },
      { key: 'contact' },
      { key: 'email' },
    ])
  })

  it('returns an empty array for an empty path', () => {
    expect(parseVariablePath('')).toEqual([])
  })

  it('parses a single segment with a wildcard bracket', () => {
    expect(parseVariablePath('vendors[*]')).toEqual([{ key: 'vendors', index: '*' }])
  })

  it('parses a positive numeric index', () => {
    expect(parseVariablePath('items[0]')).toEqual([{ key: 'items', index: 0 }])
  })

  it('parses a negative index (from the end)', () => {
    expect(parseVariablePath('items[-1]')).toEqual([{ key: 'items', index: -1 }])
  })

  it('parses multiple bracketed segments in one path', () => {
    expect(parseVariablePath('n.items[0].x[1]')).toEqual([
      { key: 'n' },
      { key: 'items', index: 0 },
      { key: 'x', index: 1 },
    ])
  })

  it('parses a wildcard bracket followed by further segments', () => {
    expect(parseVariablePath('find-1.vendors[*].region.name')).toEqual([
      { key: 'find-1' },
      { key: 'vendors', index: '*' },
      { key: 'region' },
      { key: 'name' },
    ])
  })

  // Spaces (and other non-structural characters) are legal key characters —
  // findMany's plural key can be a multi-word label like "knowledge bases"
  // (`find-output-keying.test.ts:279` pins this in the engine itself).
  it('keeps spaces inside a key intact (multi-word findMany plural keys)', () => {
    expect(parseVariablePath('find_1.knowledge bases')).toEqual([
      { key: 'find_1' },
      { key: 'knowledge bases' },
    ])
    expect(parseVariablePath('find_1.knowledge bases[*].title')).toEqual([
      { key: 'find_1' },
      { key: 'knowledge bases', index: '*' },
      { key: 'title' },
    ])
  })

  it('keeps other non-structural characters (&, /) intact inside a key', () => {
    expect(parseVariablePath('n.products & services')).toEqual([
      { key: 'n' },
      { key: 'products & services' },
    ])
    expect(parseVariablePath('n.parts/labor')).toEqual([{ key: 'n' }, { key: 'parts/labor' }])
  })

  // `first`/`last`/a bare digit are NOT grammar — they're runtime-contextual
  // array accessors the resolver applies only when the value being walked is
  // already an array. The parser must not special-case them: a segment
  // literally named "first" (a real property key) parses like any other key.
  it('parses "first"/"last"/a bare digit as ordinary keys — not special grammar', () => {
    expect(parseVariablePath('n.first')).toEqual([{ key: 'n' }, { key: 'first' }])
    expect(parseVariablePath('n.last')).toEqual([{ key: 'n' }, { key: 'last' }])
    expect(parseVariablePath('n.0')).toEqual([{ key: 'n' }, { key: '0' }])
  })

  it('parses a bracket on the first segment', () => {
    expect(parseVariablePath('items[0].name')).toEqual([
      { key: 'items', index: 0 },
      { key: 'name' },
    ])
  })
})

describe('parseArraySegmentsFromId', () => {
  it('reports basePath and ordinal for each bracketed segment', () => {
    expect(parseArraySegmentsFromId('nodeId.message.to[*].items[0].name')).toEqual([
      {
        path: 'to',
        accessor: '*',
        fullSegment: 'to[*]',
        label: 'to',
        basePath: 'nodeId.message.to',
        ordinal: 0,
      },
      {
        path: 'items',
        accessor: '0',
        fullSegment: 'items[0]',
        label: 'items',
        basePath: 'nodeId.message.to[*].items',
        ordinal: 1,
      },
    ])
  })

  it('distinguishes two same-named arrays by basePath', () => {
    const [first, second] = parseArraySegmentsFromId('n.items[*].items[0]')

    expect(first?.path).toBe('items')
    expect(second?.path).toBe('items')
    // The bare key is ambiguous; the basePath is not. This is what makes
    // `setSegmentAccessor` able to address the second one.
    expect(first?.basePath).toBe('n.items')
    expect(second?.basePath).toBe('n.items[*].items')
  })

  it('finds nothing in a bare array path (needs the store — see useVariableArraySegments)', () => {
    expect(parseArraySegmentsFromId('find_1.mzxt3cxyzhm3cbtgcbpmeir1')).toEqual([])
  })

  it('handles a multi-word key', () => {
    const [segment] = parseArraySegmentsFromId('find_1.knowledge bases[*].title')
    expect(segment?.path).toBe('knowledge bases')
    expect(segment?.basePath).toBe('find_1.knowledge bases')
  })
})

describe('setSegmentAccessor', () => {
  it('swaps an existing accessor', () => {
    expect(setSegmentAccessor('nodeId.msg.to[*].name', 'nodeId.msg.to', '0')).toBe(
      'nodeId.msg.to[0].name'
    )
  })

  it('adds a bracket to a bare array', () => {
    expect(setSegmentAccessor('find_1.orders', 'find_1.orders', '-1')).toBe('find_1.orders[-1]')
  })

  it('strips the bracket when passed null', () => {
    expect(setSegmentAccessor('find_1.orders[*]', 'find_1.orders', null)).toBe('find_1.orders')
  })

  it('edits the addressed segment when two arrays share a name', () => {
    // The old name-keyed implementation used a non-global regex on the bare key,
    // so editing the second `items` rewrote the first.
    expect(setSegmentAccessor('n.items[*].items[0]', 'n.items[*].items', '*')).toBe(
      'n.items[*].items[*]'
    )
    expect(setSegmentAccessor('n.items[*].items[0]', 'n.items', '0')).toBe('n.items[0].items[0]')
  })

  it('preserves the tail after the edited segment', () => {
    expect(
      setSegmentAccessor('find_1.cuid[*].contact_employer.company_name', 'find_1.cuid', '-1')
    ).toBe('find_1.cuid[-1].contact_employer.company_name')
  })

  it('leaves the id alone when basePath is not a segment-boundary prefix', () => {
    // "find_1.ord" is a prefix of "find_1.orders" but not a whole segment —
    // rewriting there would corrupt the key into "find_1.ord[0]ers".
    expect(setSegmentAccessor('find_1.orders[*]', 'find_1.ord', '0')).toBe('find_1.orders[*]')
    expect(setSegmentAccessor('find_1.orders[*]', 'other.path', '0')).toBe('find_1.orders[*]')
  })
})

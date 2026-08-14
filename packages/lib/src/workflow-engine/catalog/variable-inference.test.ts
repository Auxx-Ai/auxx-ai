// packages/lib/src/workflow-engine/catalog/variable-inference.test.ts

import { describe, expect, it } from 'vitest'
import { parseVariablePath } from './variable-inference'

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

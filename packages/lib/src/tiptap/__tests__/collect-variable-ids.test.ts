// packages/lib/src/tiptap/__tests__/collect-variable-ids.test.ts

import { describe, expect, it } from 'vitest'
import { collectVariableIds } from '../collect-variable-ids'

describe('collectVariableIds', () => {
  it('returns empty array for malformed input', () => {
    expect(collectVariableIds(null)).toEqual([])
    expect(collectVariableIds(undefined)).toEqual([])
    expect(collectVariableIds('not a doc')).toEqual([])
    expect(collectVariableIds(42)).toEqual([])
  })

  it('returns empty array for docs without variable chips', () => {
    expect(
      collectVariableIds({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      })
    ).toEqual([])
  })

  it('collects variable ids in document order', () => {
    expect(
      collectVariableIds({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'A ' },
              { type: 'variable-node', attrs: { variableId: 'foo.bar' } },
              { type: 'text', text: ' B ' },
              { type: 'variable-node', attrs: { variableId: 'baz' } },
            ],
          },
        ],
      })
    ).toEqual(['foo.bar', 'baz'])
  })

  it('dedupes repeated variable ids', () => {
    expect(
      collectVariableIds({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'variable-node', attrs: { variableId: 'foo' } },
              { type: 'variable-node', attrs: { variableId: 'foo' } },
              { type: 'variable-node', attrs: { variableId: 'bar' } },
            ],
          },
        ],
      })
    ).toEqual(['foo', 'bar'])
  })

  it('walks nested block containers', () => {
    expect(
      collectVariableIds({
        type: 'doc',
        content: [
          {
            type: 'block',
            attrs: { blockType: 'text' },
            content: [
              { type: 'text', text: 'hello ' },
              { type: 'variable-node', attrs: { variableId: 'a' } },
            ],
          },
          {
            type: 'block',
            attrs: { blockType: 'text' },
            content: [{ type: 'variable-node', attrs: { variableId: 'b' } }],
          },
        ],
      })
    ).toEqual(['a', 'b'])
  })

  it('skips variable-node entries with missing or non-string ids', () => {
    expect(
      collectVariableIds({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'variable-node', attrs: {} },
              { type: 'variable-node', attrs: { variableId: '' } },
              { type: 'variable-node', attrs: { variableId: 42 } },
              { type: 'variable-node', attrs: { variableId: 'ok' } },
            ],
          },
        ],
      })
    ).toEqual(['ok'])
  })
})

// packages/lib/src/tiptap/__tests__/doc-to-text.test.ts

import { describe, expect, it } from 'vitest'
import { docToText } from '../doc-to-text'

describe('docToText', () => {
  it('returns empty string for malformed input', () => {
    expect(docToText(null)).toBe('')
    expect(docToText(undefined)).toBe('')
    expect(docToText('not a doc')).toBe('')
  })

  it('flattens a simple paragraph', () => {
    expect(
      docToText({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
      })
    ).toBe('hello')
  })

  it('joins block siblings with newlines', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ],
      })
    ).toBe('a\nb')
  })

  it('renders variable-node as {{variableId}} by default', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hi ' },
              { type: 'variable-node', attrs: { variableId: 'foo.bar' } },
            ],
          },
        ],
      })
    ).toBe('Hi {{foo.bar}}')
  })

  it('uses variables callback when provided', () => {
    expect(
      docToText(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Hi ' },
                { type: 'variable-node', attrs: { variableId: 'foo.bar' } },
              ],
            },
          ],
        },
        { variables: (id) => `<${id}>` }
      )
    ).toBe('Hi <foo.bar>')
  })

  it('drops variable-node with missing/empty id', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hi ' },
              { type: 'variable-node', attrs: {} },
              { type: 'text', text: 'there' },
            ],
          },
        ],
      })
    ).toBe('Hi there')
  })

  it('renders references with default form when no resolver given', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'see ' },
              { type: 'reference', attrs: { id: 'user:1' } },
            ],
          },
        ],
      })
    ).toBe('see [reference](user:1)')
  })

  it('combines references and variables resolvers', () => {
    expect(
      docToText(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'A ' },
                { type: 'variable-node', attrs: { variableId: 'v1' } },
                { type: 'text', text: ' B ' },
                { type: 'reference', attrs: { id: 'user:1' } },
              ],
            },
          ],
        },
        { variables: (id) => `[${id}]`, references: (id) => `\`${id}\`` }
      )
    ).toBe('A [v1] B `user:1`')
  })
})

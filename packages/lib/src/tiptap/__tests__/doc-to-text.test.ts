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

  // ── v9 procedure step badges + dual-mode conditions ──────────────────────

  it('renders inline route badges as human markers', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'reference', attrs: { id: 'route:finished' } }] },
        ],
      })
    ).toBe('[end]')
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'reference', attrs: { id: 'route:handoff' } }] },
        ],
      })
    ).toBe('[hand off]')
  })

  it('resolves sub-procedure / code badge names from procedureMaps', () => {
    expect(
      docToText(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'reference', attrs: { id: 'subprocedure:s1' } }],
            },
            { type: 'paragraph', content: [{ type: 'reference', attrs: { id: 'code:c1' } }] },
          ],
        },
        {
          procedureMaps: {
            subProcedures: [{ id: 's1', name: 'Greet' }],
            codeBlocks: [{ id: 'c1', name: 'Compute' }],
          },
        }
      )
    ).toBe('[run sub-procedure Greet]\n[run code Compute]')
  })

  it('falls back to a generic marker when the map name is missing', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'reference', attrs: { id: 'subprocedure:x' } }] },
        ],
      })
    ).toBe('[run sub-procedure]')
  })

  it('renders a text-mode condition predicate', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'conditionBlock',
            attrs: { mode: 'text' },
            content: [
              {
                type: 'conditionCase',
                content: [
                  {
                    type: 'conditionPredicate',
                    content: [{ type: 'text', text: 'customer is upset' }],
                  },
                  {
                    type: 'block',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: 'apologize' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBe('IF customer is upset:\n  apologize')
  })

  it('renders a structured-mode condition by summarizing the group', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'conditionBlock',
            attrs: { mode: 'structured' },
            content: [
              {
                type: 'conditionCase',
                attrs: {
                  group: {
                    conditions: [{ fieldId: 'order.total', operator: '>', value: 100 }],
                  },
                },
                content: [
                  { type: 'conditionPredicate', content: [] },
                  {
                    type: 'block',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: 'offer refund' }] },
                    ],
                  },
                ],
              },
              {
                type: 'conditionElse',
                content: [
                  {
                    type: 'block',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: 'do nothing' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toBe('IF order.total > 100:\n  offer refund\nELSE:\n  do nothing')
  })
})

// packages/lib/src/tiptap/__tests__/text-to-doc.test.ts

import { describe, expect, it } from 'vitest'
import { textToDoc } from '../text-to-doc'

describe('textToDoc', () => {
  it('returns an empty paragraph doc for empty input', () => {
    expect(textToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(textToDoc('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('returns an empty paragraph doc for null/undefined input', () => {
    expect(textToDoc(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(textToDoc(undefined)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('coerces non-string input instead of throwing', () => {
    // Empty array (e.g. a FILE-typed multi-value workflow field) → empty doc
    expect(textToDoc([] as never)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })

    // Populated array → comma-joined, variable markers still parsed
    expect(textToDoc(['{{a}}', '{{b}}'] as never, { parseVariables: true })).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'variable-node', attrs: { variableId: 'a' } },
            { type: 'text', text: ',' },
            { type: 'variable-node', attrs: { variableId: 'b' } },
          ],
        },
      ],
    })

    expect(textToDoc(42 as never)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }],
    })
  })

  it('passes a Tiptap doc object through unchanged', () => {
    const doc = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }],
    }
    expect(textToDoc(doc)).toBe(doc)
  })

  it('wraps a single line in one paragraph', () => {
    expect(textToDoc('hello')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    })
  })

  it('splits paragraphs on double newlines', () => {
    expect(textToDoc('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    })
  })

  it('uses hard breaks for single newlines inside a paragraph', () => {
    expect(textToDoc('a\nb')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    })
  })

  it('leaves @[id] literal when parseReferences is unset', () => {
    expect(textToDoc('see @[user:abc]')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see @[user:abc]' }] }],
    })
  })

  it('emits reference nodes when parseReferences is true', () => {
    expect(textToDoc('see @[user:abc]', { parseReferences: true })).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see ' },
            { type: 'reference', attrs: { id: 'user:abc' } },
          ],
        },
      ],
    })
  })

  it('handles text on both sides of a reference', () => {
    expect(textToDoc('hi @[agent:x] there', { parseReferences: true })).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'reference', attrs: { id: 'agent:x' } },
            { type: 'text', text: ' there' },
          ],
        },
      ],
    })
  })

  it('leaves {{var}} literal when parseVariables is unset', () => {
    expect(textToDoc('Hi {{foo.bar}}')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi {{foo.bar}}' }] }],
    })
  })

  it('emits variable-node chips when parseVariables is true', () => {
    expect(textToDoc('Hi {{foo.bar}}', { parseVariables: true })).toEqual({
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
  })

  it('handles text on both sides of a variable chip', () => {
    expect(textToDoc('Hi {{foo}} there', { parseVariables: true })).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'variable-node', attrs: { variableId: 'foo' } },
            { type: 'text', text: ' there' },
          ],
        },
      ],
    })
  })

  it('combines references and variables in a single line', () => {
    expect(
      textToDoc('A {{v1}} B @[user:1] C', { parseReferences: true, parseVariables: true })
    ).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A ' },
            { type: 'variable-node', attrs: { variableId: 'v1' } },
            { type: 'text', text: ' B ' },
            { type: 'reference', attrs: { id: 'user:1' } },
            { type: 'text', text: ' C' },
          ],
        },
      ],
    })
  })
})

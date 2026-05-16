// packages/lib/src/tiptap/__tests__/text-to-doc.test.ts

import { describe, expect, it } from 'vitest'
import { textToDoc } from '../text-to-doc'

describe('textToDoc', () => {
  it('returns an empty paragraph doc for empty input', () => {
    expect(textToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(textToDoc('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
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
})

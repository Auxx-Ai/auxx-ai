// packages/lib/src/tiptap/__tests__/doc-shape.test.ts

import { describe, expect, it } from 'vitest'
import { isNonEmptyDoc, trimTrailingEmptyParagraphs } from '../doc-shape'
import type { TiptapNode } from '../types'

const para = (text?: string): TiptapNode =>
  text === undefined
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [{ type: 'text', text }] }

describe('trimTrailingEmptyParagraphs', () => {
  it('returns doc unchanged when no content array', () => {
    const doc: TiptapNode = { type: 'doc' }
    expect(trimTrailingEmptyParagraphs(doc)).toEqual({ type: 'doc' })
  })

  it('strips trailing bare empty paragraphs', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('hello'), para(), para()],
    }
    expect(trimTrailingEmptyParagraphs(doc).content).toEqual([para('hello')])
  })

  it('strips paragraphs whose only content is whitespace text', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('hi'), { type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
    }
    expect(trimTrailingEmptyParagraphs(doc).content).toEqual([para('hi')])
  })

  it('strips paragraphs that only contain a hardBreak', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('line 1'), { type: 'paragraph', content: [{ type: 'hardBreak' }] }],
    }
    expect(trimTrailingEmptyParagraphs(doc).content).toEqual([para('line 1')])
  })

  it('keeps at least one paragraph when the whole doc is empty', () => {
    const doc: TiptapNode = { type: 'doc', content: [para(), para(), para()] }
    const out = trimTrailingEmptyParagraphs(doc)
    expect(out.content?.length).toBe(1)
  })

  it('does not touch internal empty paragraphs', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [para('first'), para(), para('last')],
    }
    expect(trimTrailingEmptyParagraphs(doc).content).toEqual([para('first'), para(), para('last')])
  })

  it('does not strip non-paragraph trailing nodes', () => {
    const trailing: TiptapNode = { type: 'image', attrs: { src: 'x' } }
    const doc: TiptapNode = { type: 'doc', content: [para('hi'), trailing] }
    expect(trimTrailingEmptyParagraphs(doc).content).toEqual([para('hi'), trailing])
  })
})

describe('isNonEmptyDoc', () => {
  it('returns false for empty input', () => {
    expect(isNonEmptyDoc(null)).toBe(false)
    expect(isNonEmptyDoc(undefined)).toBe(false)
    expect(isNonEmptyDoc({})).toBe(false)
  })

  it('returns false for doc with only empty paragraphs', () => {
    expect(isNonEmptyDoc({ type: 'doc', content: [para(), para()] })).toBe(false)
  })

  it('returns false for whitespace-only text', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
    }
    expect(isNonEmptyDoc(doc)).toBe(false)
  })

  it('returns true when a text node has non-whitespace content', () => {
    expect(isNonEmptyDoc({ type: 'doc', content: [para('hi')] })).toBe(true)
  })

  it('returns true when a reference node is present', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'reference', attrs: { id: 'user:abc' } }] }],
    }
    expect(isNonEmptyDoc(doc)).toBe(true)
  })

  it('returns true when a mention node is present', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { label: 'a' } }] }],
    }
    expect(isNonEmptyDoc(doc)).toBe(true)
  })
})

// packages/lib/src/references/__tests__/preresolve.test.ts

import { describe, expect, it } from 'vitest'
import type { RecordId } from '../../resources/client'
// `collectReferenceIds` moved to the tiptap module; `preresolve` imports it but
// no longer re-exports it.
import { collectReferenceIds } from '../../tiptap'
import { preresolveReferences } from '../preresolve'

const docWith = (...refs: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'block',
      attrs: { blockType: 'text' },
      content: [
        { type: 'text', text: 'See ' },
        ...refs.map((id) => ({ type: 'reference', attrs: { id } })),
        { type: 'text', text: ' for details.' },
      ],
    },
  ],
})

describe('collectReferenceIds', () => {
  it('returns [] for non-objects, empty docs, and unknown shapes', () => {
    expect(collectReferenceIds(null)).toEqual([])
    expect(collectReferenceIds(undefined)).toEqual([])
    expect(collectReferenceIds('hello')).toEqual([])
    expect(collectReferenceIds({})).toEqual([])
    expect(collectReferenceIds({ type: 'doc', content: [] })).toEqual([])
  })

  it('collects reference ids in document order, de-duped', () => {
    const doc = docWith('article:a', 'agent:x', 'article:a', 'user:u')
    expect(collectReferenceIds(doc)).toEqual(['article:a', 'agent:x', 'user:u'])
  })

  it('ignores reference nodes with no id', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'block',
          attrs: { blockType: 'text' },
          content: [
            { type: 'reference', attrs: {} },
            { type: 'reference' },
            { type: 'reference', attrs: { id: 'article:b' } },
          ],
        },
      ],
    }
    expect(collectReferenceIds(doc)).toEqual(['article:b'])
  })
})

describe('preresolveReferences', () => {
  it('skips the title fetch when there are no references', async () => {
    let called = false
    const out = await preresolveReferences({ type: 'doc', content: [] }, async () => {
      called = true
      return new Map()
    })
    expect(called).toBe(false)
    expect(out.recordIds).toEqual([])
    expect(out.titles.size).toBe(0)
  })

  it('renders resolved titles as markdown links and falls back to [reference](id)', async () => {
    const doc = docWith('article:a', 'agent:x')
    const out = await preresolveReferences(
      doc,
      async (ids) =>
        new Map(ids.map((id) => [id, id === ('article:a' as RecordId) ? 'Refunds' : '']))
    )
    expect(out.recordIds).toEqual(['article:a', 'agent:x'])
    expect(out.render('article:a')).toBe('[Refunds](article:a)')
    // Empty title → bare form so the LLM still sees the id.
    expect(out.render('agent:x')).toBe('[reference](agent:x)')
    // Unknown id → bare form.
    expect(out.render('thread:z')).toBe('[reference](thread:z)')
  })
})

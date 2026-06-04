// packages/lib/src/kb/markdown/__tests__/block-id.test.ts

import { describe, expect, it } from 'vitest'
import { blockIdNumber, createBlockIdAllocator, maxBlockNumber, reassignIds } from '../block-id'
import { mdToBlocks } from '../md-to-blocks'
import type { ArticleNodeJSON } from '../types'

const block = (id: string | undefined): ArticleNodeJSON => ({
  type: 'block',
  attrs: id === undefined ? { blockType: 'text' } : { id, blockType: 'text' },
  content: [],
})

describe('blockIdNumber', () => {
  it('parses b<n> ids', () => {
    expect(blockIdNumber('b1')).toBe(1)
    expect(blockIdNumber('b42')).toBe(42)
  })

  it('returns null for non-sequential or empty ids', () => {
    expect(blockIdNumber('V1StGXR8_Z5jdHi6B-myT')).toBeNull()
    expect(blockIdNumber('b')).toBeNull()
    expect(blockIdNumber('b1x')).toBeNull()
    expect(blockIdNumber('')).toBeNull()
    expect(blockIdNumber(null)).toBeNull()
    expect(blockIdNumber(undefined)).toBeNull()
  })
})

describe('maxBlockNumber', () => {
  it('is 0 for an empty body or all-legacy ids', () => {
    expect(maxBlockNumber([])).toBe(0)
    expect(maxBlockNumber([block('legacy-nanoid')])).toBe(0)
  })

  it('finds the max across top-level blocks', () => {
    expect(maxBlockNumber([block('b1'), block('b5'), block('b3')])).toBe(5)
  })

  it('descends into containers — tabs/accordion panels and table cells', () => {
    const body: ArticleNodeJSON[] = [
      block('b2'),
      {
        type: 'tabs',
        attrs: { id: 'b7', activeTab: null },
        content: [{ type: 'panel', attrs: { id: 'b8', label: 'T' }, content: [block('b9')] }],
      },
      {
        type: 'table',
        attrs: { id: 'b4' },
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [block('b11')] }],
          },
        ],
      },
    ]
    expect(maxBlockNumber(body)).toBe(11)
  })
})

describe('createBlockIdAllocator', () => {
  it('hands out ids strictly above the doc max', () => {
    const next = createBlockIdAllocator([block('b3'), block('b6')])
    expect(next()).toBe('b7')
    expect(next()).toBe('b8')
  })

  it('starts at b1 for an empty doc', () => {
    const next = createBlockIdAllocator([])
    expect(next()).toBe('b1')
  })
})

describe('reassignIds', () => {
  it('forces fresh sequential ids on every block, panel, and container', () => {
    const body: ArticleNodeJSON[] = [
      block('keep?'),
      {
        type: 'accordion',
        attrs: { id: 'x', allowMultiple: true },
        content: [{ type: 'panel', attrs: { id: 'y', label: 'Q' }, content: [block('z')] }],
      },
    ]
    const out = reassignIds(body, createBlockIdAllocator([]))
    const first = out[0]
    expect(first.type === 'block' && first.attrs.id).toBe('b1')
    const acc = out[1]
    if (acc.type !== 'accordion') throw new Error('expected accordion')
    expect(acc.attrs.id).toBe('b2')
    expect(acc.content[0].attrs.id).toBe('b3')
    expect(acc.content[0].content[0].attrs.id).toBe('b4')
  })

  it('seeds above an existing doc so inserted ids never collide', () => {
    const doc: ArticleNodeJSON[] = [block('b1'), block('b2')]
    const inserted = reassignIds([block('b1'), block('b2')], createBlockIdAllocator(doc))
    const insertedIds = inserted.map((n) => (n.type === 'block' ? n.attrs.id : null))
    expect(insertedIds).toEqual(['b3', 'b4'])
    // No overlap with the target doc's ids.
    const docIds = new Set(doc.map((n) => (n.type === 'block' ? n.attrs.id : '')))
    for (const id of insertedIds) expect(docIds.has(id as string)).toBe(false)
  })

  it('does not mutate the input', () => {
    const body = [block('b9')]
    reassignIds(body, createBlockIdAllocator([]))
    expect(body[0].type === 'block' && body[0].attrs.id).toBe('b9')
  })
})

describe('mdToBlocks — sequential ids', () => {
  it('numbers parsed blocks b1, b2, … in document order', () => {
    const nodes = mdToBlocks('One.\n\nTwo.\n\nThree.')
    expect(nodes.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual(['b1', 'b2', 'b3'])
  })

  it('numbers a table container and its cell blocks with no gaps or dupes', () => {
    const nodes = mdToBlocks('| h1 | h2 |\n| --- | --- |\n| 1 | 2 |')
    const ids: string[] = []
    for (const n of nodes) {
      if (n.type === 'table') {
        ids.push(n.attrs?.id ?? '')
        for (const row of n.content)
          for (const cell of row.content)
            for (const b of cell.content) {
              ids.push(b.attrs.id ?? '')
            }
      }
    }
    expect(ids.every((id) => /^b\d+$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length) // all unique
  })
})

// packages/lib/src/kb/blocks/__tests__/apply-patch.test.ts

import { describe, expect, it } from 'vitest'
import type { ArticleNodeJSON, BlockJSON, TableJSON, TabsJSON } from '../../markdown/types'
import { applyPatch, PatchError } from '../apply-patch'

const block = (id: string, text = ''): BlockJSON => ({
  type: 'block',
  attrs: { id, blockType: 'text' },
  content: text ? [{ type: 'text', text }] : [],
})

const heading = (id: string, level: number, text: string): BlockJSON => ({
  type: 'block',
  attrs: { id, blockType: 'heading', level },
  content: [{ type: 'text', text }],
})

function expectTabs(node: ArticleNodeJSON | undefined): TabsJSON {
  expect(node?.type).toBe('tabs')
  if (!node || node.type !== 'tabs') throw new Error('expected a tabs node')
  return node
}

function expectTable(node: ArticleNodeJSON | undefined): TableJSON {
  expect(node?.type).toBe('table')
  if (!node || node.type !== 'table') throw new Error('expected a table node')
  return node
}

function expectBlock(node: ArticleNodeJSON | undefined): BlockJSON {
  expect(node?.type).toBe('block')
  if (!node || node.type !== 'block') throw new Error('expected a block node')
  return node
}

function expectAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  expect(item).toBeDefined()
  if (item === undefined) throw new Error(`expected item at index ${index}`)
  return item
}

describe('applyPatch — insert', () => {
  it('inserts at start', () => {
    const doc: ArticleNodeJSON[] = [block('b1', 'one'), block('b2', 'two')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'start' },
      blocks: [block('new', 'first')],
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'new',
      'b1',
      'b2',
    ])
    expect(out.effect).toEqual({ op: 'insert', blockIds: ['new'] })
  })

  it('inserts at end', () => {
    const doc: ArticleNodeJSON[] = [block('b1'), block('b2')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'end' },
      blocks: [block('new')],
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'b1',
      'b2',
      'new',
    ])
  })

  it('inserts before a top-level block', () => {
    const doc: ArticleNodeJSON[] = [block('b1'), block('b2'), block('b3')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'before', blockId: 'b2' },
      blocks: [block('new')],
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'b1',
      'new',
      'b2',
      'b3',
    ])
  })

  it('inserts after a top-level block', () => {
    const doc: ArticleNodeJSON[] = [block('b1'), block('b2'), block('b3')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'after', blockId: 'b2' },
      blocks: [block('new')],
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'b1',
      'b2',
      'new',
      'b3',
    ])
  })

  it('inserts inside a panel via startOf', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab 1' },
            content: [block('b-in', 'inside')],
          },
        ],
      },
    ]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'startOf', containerId: 'p1' },
      blocks: [block('new')],
    })
    const tabs = expectTabs(out.content[0])
    expect(expectAt(tabs.content, 0).content.map((b) => b.attrs.id)).toEqual(['new', 'b-in'])
  })

  it('inserts inside a panel via endOf', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab 1' },
            content: [block('b-in')],
          },
        ],
      },
    ]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'endOf', containerId: 'p1' },
      blocks: [block('new')],
    })
    const tabs = expectTabs(out.content[0])
    expect(expectAt(tabs.content, 0).content.map((b) => b.attrs.id)).toEqual(['b-in', 'new'])
  })

  it('inserts before a block that lives inside a panel', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab 1' },
            content: [block('a'), block('b'), block('c')],
          },
        ],
      },
    ]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'before', blockId: 'b' },
      blocks: [block('new')],
    })
    const tabs = expectTabs(out.content[0])
    expect(expectAt(tabs.content, 0).content.map((b) => b.attrs.id)).toEqual(['a', 'new', 'b', 'c'])
  })

  it('throws on missing anchor block', () => {
    const doc: ArticleNodeJSON[] = [block('b1')]
    expect(() =>
      applyPatch(doc, {
        op: 'insert',
        anchor: { at: 'after', blockId: 'nope' },
        blocks: [block('new')],
      })
    ).toThrow(PatchError)
  })

  it('inserts a table container at top-level', () => {
    const doc: ArticleNodeJSON[] = [block('b1')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'end' },
      blocks: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [block('h1', 'A')] },
                { type: 'tableHeader', content: [block('h2', 'B')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [block('c1', '1')] },
                { type: 'tableCell', content: [block('c2', '2')] },
              ],
            },
          ],
        },
      ],
    })
    expect(out.content).toHaveLength(2)
    expect(out.content[1]?.type).toBe('table')
    expect(out.effect.blockIds).toEqual([])
  })

  it('rejects a container inserted into a panel', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [{ type: 'panel', attrs: { id: 'p1', label: 'T' }, content: [block('inside')] }],
      },
    ]
    expect(() =>
      applyPatch(doc, {
        op: 'insert',
        anchor: { at: 'endOf', containerId: 'p1' },
        blocks: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [{ type: 'tableCell', content: [block('c', 'x')] }],
              },
            ],
          },
        ],
      })
    ).toThrow(PatchError)
  })
})

describe('applyPatch — replace', () => {
  it('replaces a top-level block, preserving id', () => {
    const doc: ArticleNodeJSON[] = [block('b1', 'old'), block('b2')]
    const out = applyPatch(doc, {
      op: 'replace',
      blockId: 'b1',
      block: heading('ignored-id', 1, 'New title'),
    })
    const first = expectBlock(out.content[0])
    expect(first.attrs.id).toBe('b1')
    expect(first.attrs.blockType).toBe('heading')
    expect(first.attrs.level).toBe(1)
  })

  it('replaces a block inside a table cell', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [block('cell-b', 'old')] }],
          },
        ],
      },
    ]
    const out = applyPatch(doc, {
      op: 'replace',
      blockId: 'cell-b',
      block: heading('x', 2, 'new'),
    })
    const table = expectTable(out.content[0])
    const row = expectAt(table.content, 0)
    const cell = expectAt(row.content, 0)
    const replaced = expectAt(cell.content, 0)
    expect(replaced.attrs.id).toBe('cell-b')
    expect(replaced.attrs.blockType).toBe('heading')
  })
})

describe('applyPatch — updateText', () => {
  it('replaces inline content', () => {
    const doc: ArticleNodeJSON[] = [block('b1', 'old text')]
    const out = applyPatch(doc, {
      op: 'updateText',
      blockId: 'b1',
      content: [{ type: 'text', text: 'new text' }],
    })
    const first = expectBlock(out.content[0])
    expect(first.content?.[0]).toMatchObject({ type: 'text', text: 'new text' })
    expect(first.attrs.blockType).toBe('text')
  })
})

describe('applyPatch — updateAttrs', () => {
  it('merges attrs without overwriting id', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'block',
        attrs: { id: 'cb1', blockType: 'callout', calloutVariant: 'info' },
        content: [],
      },
    ]
    const out = applyPatch(doc, {
      op: 'updateAttrs',
      blockId: 'cb1',
      attrs: { calloutVariant: 'warn', id: 'should-not-stick' } as Partial<BlockJSON['attrs']> & {
        id?: string
      },
    })
    const first = expectBlock(out.content[0])
    expect(first.attrs.id).toBe('cb1')
    expect(first.attrs.calloutVariant).toBe('warn')
  })
})

describe('applyPatch — delete', () => {
  it('deletes top-level blocks', () => {
    const doc: ArticleNodeJSON[] = [block('a'), block('b'), block('c')]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['b'] })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual(['a', 'c'])
    expect(out.effect.blockIds).toEqual(['b'])
  })

  it('deletes blocks inside panels', () => {
    const doc: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab' },
            content: [block('a'), block('b'), block('c')],
          },
        ],
      },
    ]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['b'] })
    const tabs = expectTabs(out.content[0])
    expect(expectAt(tabs.content, 0).content.map((b) => b.attrs.id)).toEqual(['a', 'c'])
  })

  it('throws on missing block', () => {
    const doc: ArticleNodeJSON[] = [block('a')]
    expect(() => applyPatch(doc, { op: 'delete', blockIds: ['nope'] })).toThrow(PatchError)
  })
})

describe('applyPatch — move', () => {
  it('moves a top-level block to a new anchor', () => {
    const doc: ArticleNodeJSON[] = [block('a'), block('b'), block('c'), block('d')]
    const out = applyPatch(doc, {
      op: 'move',
      blockIds: ['c'],
      anchor: { at: 'before', blockId: 'a' },
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })

  it('moves a nested block to a top-level anchor', () => {
    const doc: ArticleNodeJSON[] = [
      block('top1'),
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'T' },
            content: [block('nested')],
          },
        ],
      },
    ]
    const out = applyPatch(doc, {
      op: 'move',
      blockIds: ['nested'],
      anchor: { at: 'after', blockId: 'top1' },
    })
    // top1, nested, then tabs (with empty panel? — panel had only that block)
    const ids = out.content.map((n) => (n.type === 'block' ? n.attrs.id : `[${n.type}]`))
    expect(ids).toEqual(['top1', 'nested', '[tabs]'])
  })

  it('moves multiple blocks preserving requested order', () => {
    const doc: ArticleNodeJSON[] = [block('a'), block('b'), block('c'), block('d')]
    const out = applyPatch(doc, {
      op: 'move',
      blockIds: ['c', 'a'],
      anchor: { at: 'end' },
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : null))).toEqual([
      'b',
      'd',
      'c',
      'a',
    ])
  })
})

describe('applyPatch — top-level + container interleaving', () => {
  it('preserves containers when inserting before a top-level block', () => {
    const doc: ArticleNodeJSON[] = [
      block('a'),
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [{ type: 'panel', attrs: { id: 'p1', label: 'T' }, content: [block('inner')] }],
      },
      block('b'),
    ]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'before', blockId: 'b' },
      blocks: [block('new')],
    })
    const ids = out.content.map((n) => (n.type === 'block' ? n.attrs.id : `[${n.type}]`))
    expect(ids).toEqual(['a', '[tabs]', 'new', 'b'])
  })
})

const tableNode = (id: string): ArticleNodeJSON => ({
  type: 'table',
  attrs: { id },
  content: [
    {
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [block(`${id}-c1`, 'cell')] }],
    },
  ],
})

const tabsNode = (id: string, panelId = `${id}-p1`): ArticleNodeJSON => ({
  type: 'tabs',
  attrs: { id, activeTab: null },
  content: [
    { type: 'panel', attrs: { id: panelId, label: 'Tab 1' }, content: [block(`${panelId}-b`)] },
  ],
})

const accordionNode = (id: string, panelId = `${id}-p1`): ArticleNodeJSON => ({
  type: 'accordion',
  attrs: { id, allowMultiple: true },
  content: [
    { type: 'panel', attrs: { id: panelId, label: 'Section' }, content: [block(`${panelId}-b`)] },
  ],
})

describe('applyPatch — containers', () => {
  it('deletes a top-level table by id', () => {
    const doc: ArticleNodeJSON[] = [block('a'), tableNode('t1'), block('b')]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['t1'] })
    const types = out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))
    expect(types).toEqual(['a', 'b'])
    expect(out.effect).toEqual({ op: 'delete', blockIds: ['t1'] })
  })

  it('deletes a top-level tabs by id', () => {
    const doc: ArticleNodeJSON[] = [tabsNode('tabs1'), block('a')]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['tabs1'] })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual(['a'])
  })

  it('deletes a top-level accordion by id', () => {
    const doc: ArticleNodeJSON[] = [accordionNode('ac1'), block('a')]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['ac1'] })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual(['a'])
  })

  it('deletes a mix of containers and leaf blocks in one call', () => {
    const doc: ArticleNodeJSON[] = [block('a'), tableNode('t1'), block('b'), tabsNode('tabs1')]
    const out = applyPatch(doc, { op: 'delete', blockIds: ['t1', 'b', 'tabs1'] })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual(['a'])
    expect(new Set(out.effect.blockIds)).toEqual(new Set(['t1', 'b', 'tabs1']))
  })

  it('moves a top-level table to start', () => {
    const doc: ArticleNodeJSON[] = [block('a'), block('b'), tableNode('t1')]
    const out = applyPatch(doc, {
      op: 'move',
      blockIds: ['t1'],
      anchor: { at: 'start' },
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual([
      'table',
      'a',
      'b',
    ])
  })

  it('moves a table before a leaf block at the top level', () => {
    const doc: ArticleNodeJSON[] = [block('a'), block('b'), tableNode('t1')]
    const out = applyPatch(doc, {
      op: 'move',
      blockIds: ['t1'],
      anchor: { at: 'before', blockId: 'b' },
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual([
      'a',
      'table',
      'b',
    ])
  })

  it('rejects moving a container into a panel', () => {
    const doc: ArticleNodeJSON[] = [tabsNode('tabs1', 'p1'), tableNode('t1')]
    expect(() =>
      applyPatch(doc, {
        op: 'move',
        blockIds: ['t1'],
        anchor: { at: 'startOf', containerId: 'p1' },
      })
    ).toThrow(PatchError)
  })

  it('rejects moving a container before a nested leaf id', () => {
    // The nested leaf 'p1-p1-b' lives inside the panel, not at top level.
    const doc: ArticleNodeJSON[] = [tabsNode('tabs1', 'p1'), tableNode('t1')]
    expect(() =>
      applyPatch(doc, {
        op: 'move',
        blockIds: ['t1'],
        anchor: { at: 'before', blockId: 'p1-b' },
      })
    ).toThrow(PatchError)
  })

  it('inserts a leaf before a top-level container id', () => {
    const doc: ArticleNodeJSON[] = [block('a'), tableNode('t1'), block('b')]
    const out = applyPatch(doc, {
      op: 'insert',
      anchor: { at: 'before', blockId: 't1' },
      blocks: [block('new')],
    })
    expect(out.content.map((n) => (n.type === 'block' ? n.attrs.id : n.type))).toEqual([
      'a',
      'new',
      'table',
      'b',
    ])
  })
})

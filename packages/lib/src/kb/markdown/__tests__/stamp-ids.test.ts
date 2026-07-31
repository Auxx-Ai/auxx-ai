// packages/lib/src/kb/markdown/__tests__/stamp-ids.test.ts

import { describe, expect, it } from 'vitest'
import { stampBlockIds } from '../stamp-ids'
import { accordionAt, blockAt, cellBlockAt, panelAt, tableAt, tabsAt } from '../test-helpers'
import type { ArticleNodeJSON } from '../types'

describe('stampBlockIds', () => {
  it('stamps ids on top-level blocks missing one', () => {
    const input: ArticleNodeJSON[] = [
      { type: 'block', attrs: { blockType: 'text' }, content: [] },
      { type: 'block', attrs: { blockType: 'heading', level: 1 }, content: [] },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(blockAt(content, 0).attrs.id).toMatch(/.+/)
    expect(blockAt(content, 1).attrs.id).toMatch(/.+/)
  })

  it('preserves existing unique ids', () => {
    const input: ArticleNodeJSON[] = [
      { type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] },
      { type: 'block', attrs: { id: 'b2', blockType: 'text' }, content: [] },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(false)
    expect(blockAt(content, 0).attrs.id).toBe('b1')
    expect(blockAt(content, 1).attrs.id).toBe('b2')
  })

  it('replaces duplicate ids', () => {
    const input: ArticleNodeJSON[] = [
      { type: 'block', attrs: { id: 'dup', blockType: 'text' }, content: [] },
      { type: 'block', attrs: { id: 'dup', blockType: 'text' }, content: [] },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(blockAt(content, 0).attrs.id).toBe('dup')
    expect(blockAt(content, 1).attrs.id).not.toBe('dup')
    expect(blockAt(content, 1).attrs.id).toMatch(/.+/)
  })

  it('stamps ids on panel blocks and panel children', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: '', label: 'Tab 1' },
            content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    const panel = panelAt(tabsAt(content))
    expect(panel.attrs.id).toMatch(/.+/)
    expect(blockAt(panel.content).attrs.id).toMatch(/.+/)
  })

  it('stamps ids inside table cells', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
              },
            ],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(cellBlockAt(tableAt(content), 0, 0).attrs.id).toMatch(/.+/)
  })

  it('is idempotent — stamping a fully-stamped doc returns changed: false', () => {
    const input: ArticleNodeJSON[] = [
      { type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] },
      {
        type: 'tabs',
        attrs: { id: 'tabs1', activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab 1' },
            content: [{ type: 'block', attrs: { id: 'b2', blockType: 'text' }, content: [] }],
          },
        ],
      },
    ]
    const first = stampBlockIds(input)
    expect(first.changed).toBe(false)
    const second = stampBlockIds(first.content)
    expect(second.changed).toBe(false)
  })

  it('stamps id on a table container that lacks one', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
              },
            ],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(tableAt(content).attrs?.id).toMatch(/.+/)
  })

  it('stamps id on a tabs container and preserves activeTab', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: 'p1' },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Tab 1' },
            content: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(tabsAt(content).attrs.id).toMatch(/.+/)
    expect(tabsAt(content).attrs.activeTab).toBe('p1')
  })

  it('stamps id on an accordion container and preserves allowMultiple', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'accordion',
        attrs: { allowMultiple: false },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'Section 1' },
            content: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(accordionAt(content).attrs.id).toMatch(/.+/)
    expect(accordionAt(content).attrs.allowMultiple).toBe(false)
  })

  it('preserves an existing container id', () => {
    const input: ArticleNodeJSON[] = [
      {
        type: 'table',
        attrs: { id: 'keep-me' },
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
              },
            ],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(false)
    expect(tableAt(content).attrs?.id).toBe('keep-me')
  })

  it('replaces a duplicate container id', () => {
    const input: ArticleNodeJSON[] = [
      { type: 'block', attrs: { id: 'dup', blockType: 'text' }, content: [] },
      {
        type: 'table',
        attrs: { id: 'dup' },
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
              },
            ],
          },
        ],
      },
    ]
    const { content, changed } = stampBlockIds(input)
    expect(changed).toBe(true)
    expect(tableAt(content, 1).attrs?.id).not.toBe('dup')
    expect(tableAt(content, 1).attrs?.id).toMatch(/.+/)
  })
})

// packages/lib/src/kb/markdown/__tests__/tabs-roundtrip.test.ts

import { describe, expect, it } from 'vitest'
import { blocksToMd } from '../blocks-to-md'
import { mdToBlocks } from '../md-to-blocks'
import type { DocJSON, TabsJSON } from '../types'

function makeTabsDoc(): DocJSON {
  return {
    type: 'doc',
    content: [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'JavaScript', iconId: 'javascript' },
            content: [
              {
                type: 'block',
                attrs: { blockType: 'text' },
                content: [{ type: 'text', text: 'JS body.' }],
              },
              {
                type: 'block',
                attrs: { blockType: 'codeBlock', codeLanguage: 'js' },
                content: [{ type: 'text', text: "console.log('hi')" }],
              },
            ],
          },
          {
            type: 'panel',
            attrs: { id: 'p2', label: 'TypeScript' },
            content: [
              {
                type: 'block',
                attrs: { blockType: 'text' },
                content: [{ type: 'text', text: 'TS body.' }],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('tabs markdown serialization', () => {
  it('renders a tabs block with per-panel content', () => {
    const md = blocksToMd(makeTabsDoc())
    expect(md).toContain('::::tabs')
    expect(md).toContain(':::tab{label="JavaScript" icon="javascript"}')
    expect(md).toContain(':::tab{label="TypeScript"}')
    expect(md).toContain("console.log('hi')")
    expect(md).toContain('TS body')
    expect(md.trim().endsWith('::::')).toBe(true)
  })

  it('round-trips structure with mixed block types per panel', () => {
    const original = makeTabsDoc()
    const md = blocksToMd(original)
    const reparsed = mdToBlocks(md)
    const tabs = reparsed.content[0] as TabsJSON
    expect(tabs.type).toBe('tabs')
    expect(tabs.content).toHaveLength(2)
    expect(tabs.content[0].attrs.label).toBe('JavaScript')
    expect(tabs.content[0].attrs.iconId).toBe('javascript')
    expect(tabs.content[1].attrs.label).toBe('TypeScript')

    // First panel: text + codeBlock
    const firstPanelBlocks = tabs.content[0].content
    expect(firstPanelBlocks).toHaveLength(2)
    expect(firstPanelBlocks[0].attrs.blockType).toBe('text')
    expect(firstPanelBlocks[1].attrs.blockType).toBe('codeBlock')
    expect(firstPanelBlocks[1].attrs.codeLanguage).toBe('js')
  })

  it('regenerates panel ids on import (Q6c)', () => {
    const original = makeTabsDoc()
    const md = blocksToMd(original)
    const reparsed = mdToBlocks(md)
    const tabs = reparsed.content[0] as TabsJSON
    expect(tabs.content[0].attrs.id).not.toBe('p1')
    expect(tabs.content[1].attrs.id).not.toBe('p2')
    expect(tabs.content[0].attrs.id).toBeTruthy()
    expect(tabs.content[1].attrs.id).toBeTruthy()
  })

  it('renders nothing for an empty tabs container', () => {
    const md = blocksToMd({
      type: 'doc',
      content: [{ type: 'tabs', attrs: { activeTab: null }, content: [] }],
    })
    expect(md.trim()).toBe('')
  })
})

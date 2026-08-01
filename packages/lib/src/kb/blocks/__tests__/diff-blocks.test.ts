// packages/lib/src/kb/blocks/__tests__/diff-blocks.test.ts

import { describe, expect, it } from 'vitest'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  TableJSON,
  TabsJSON,
} from '../../markdown/types'
import { diffBlockList, diffBlocks } from '../diff-blocks'
import { diffInline, inlineToText } from '../inline-diff'

const block = (id: string, text = ''): BlockJSON => ({
  type: 'block',
  attrs: { id, blockType: 'text' },
  content: text ? [{ type: 'text', text }] : [],
})

function expectAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  expect(item).toBeDefined()
  if (item === undefined) throw new Error(`expected item at index ${index}`)
  return item
}

describe('diffBlocks — top level', () => {
  it('detects added / removed / unchanged', () => {
    const before: ArticleNodeJSON[] = [block('a', 'one'), block('b', 'two')]
    const after: ArticleNodeJSON[] = [block('a', 'one'), block('c', 'three')]
    const { blocks, stats } = diffBlocks(before, after)

    expect(blocks.map((d) => [d.status, d.id])).toEqual([
      ['unchanged', 'a'],
      ['removed', 'b'],
      ['added', 'c'],
    ])
    expect(stats).toEqual({ added: 1, removed: 1, modified: 0, moved: 0 })
  })

  it('keeps a removed block in its old position', () => {
    const before: ArticleNodeJSON[] = [block('a'), block('b'), block('c')]
    const after: ArticleNodeJSON[] = [block('a'), block('c')]
    const { blocks } = diffBlocks(before, after)
    expect(blocks.map((d) => [d.status, d.id])).toEqual([
      ['unchanged', 'a'],
      ['removed', 'b'],
      ['unchanged', 'c'],
    ])
  })

  it('classifies a modified leaf with word-level inline spans', () => {
    const before: ArticleNodeJSON[] = [block('a', 'the quick brown fox')]
    const after: ArticleNodeJSON[] = [block('a', 'the slow brown fox')]
    const { blocks, stats } = diffBlocks(before, after)

    expect(blocks).toHaveLength(1)
    const d = expectAt(blocks, 0)
    expect(d.status).toBe('modified')
    expect(d.prevBlock).toBeDefined()
    // 'quick' deleted, 'slow' inserted; surrounding words unchanged.
    expect(d.inline).toBeDefined()
    expect(d.inline?.filter((s) => s.type === 'del').map((s) => s.text)).toContain('quick')
    expect(d.inline?.filter((s) => s.type === 'ins').map((s) => s.text)).toContain('slow')
    // Reconstruct each side from the spans.
    const oldText = d.inline
      ?.filter((s) => s.type !== 'ins')
      .map((s) => s.text)
      .join('')
    const newText = d.inline
      ?.filter((s) => s.type !== 'del')
      .map((s) => s.text)
      .join('')
    expect(oldText).toBe('the quick brown fox')
    expect(newText).toBe('the slow brown fox')
    expect(stats.modified).toBe(1)
  })

  it('treats a reordered block as moved with LCS ordering preserved', () => {
    // 'a','b','c' stay in order on both sides (the unambiguous LCS); only 'd'
    // jumps to the front, so it's the single moved block.
    const before: ArticleNodeJSON[] = [block('a'), block('b'), block('c'), block('d')]
    const after: ArticleNodeJSON[] = [block('d'), block('a'), block('b'), block('c')]
    const { blocks, stats } = diffBlocks(before, after)

    expect(blocks.map((d) => [d.status, d.id])).toEqual([
      ['moved', 'd'],
      ['unchanged', 'a'],
      ['unchanged', 'b'],
      ['unchanged', 'c'],
    ])
    expect(stats.moved).toBe(1)
  })

  it('treats delete-then-add (different ids) as remove + add, not modified', () => {
    const before: ArticleNodeJSON[] = [block('a', 'gone')]
    const after: ArticleNodeJSON[] = [block('b', 'fresh')]
    const { blocks, stats } = diffBlocks(before, after)
    expect(blocks.map((d) => d.status)).toEqual(['removed', 'added'])
    expect(stats).toEqual({ added: 1, removed: 1, modified: 0, moved: 0 })
  })

  it('handles null / empty on either side', () => {
    expect(diffBlocks(null, [block('a')]).blocks.map((d) => d.status)).toEqual(['added'])
    expect(diffBlocks([block('a')], undefined).blocks.map((d) => d.status)).toEqual(['removed'])
    expect(diffBlocks(null, null).blocks).toEqual([])
  })

  it('ignores a codeHighlightedHtml-only change', () => {
    const codeBefore: BlockJSON = {
      type: 'block',
      attrs: { id: 'code1', blockType: 'codeBlock', codeLanguage: 'ts' },
      content: [{ type: 'text', text: 'const x = 1' }],
    }
    const codeAfter: BlockJSON = {
      ...codeBefore,
      attrs: { ...codeBefore.attrs, codeHighlightedHtml: '<pre>highlighted</pre>' },
    }
    const { blocks, stats } = diffBlocks([codeBefore], [codeAfter])
    expect(blocks.map((d) => d.status)).toEqual(['unchanged'])
    expect(stats).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 })
  })

  it('marks a marks-only change as modified with no inline spans', () => {
    const before: BlockJSON = {
      type: 'block',
      attrs: { id: 'a', blockType: 'text' },
      content: [{ type: 'text', text: 'hello' }],
    }
    const after: BlockJSON = {
      type: 'block',
      attrs: { id: 'a', blockType: 'text' },
      content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }],
    }
    const { blocks } = diffBlocks([before], [after])
    const diff = expectAt(blocks, 0)
    expect(diff.status).toBe('modified')
    expect(diff.inline).toEqual([])
  })
})

describe('diffBlocks — nested containers', () => {
  const tabs = (id: string, panelBlocks: BlockJSON[]): TabsJSON => ({
    type: 'tabs',
    attrs: { id },
    content: [{ type: 'panel', attrs: { id: `${id}-p1`, label: 'Tab 1' }, content: panelBlocks }],
  })

  const accordion = (id: string, panelBlocks: BlockJSON[]): AccordionJSON => ({
    type: 'accordion',
    attrs: { id, allowMultiple: false },
    content: [{ type: 'panel', attrs: { id: `${id}-p1`, label: 'Item' }, content: panelBlocks }],
  })

  const table = (id: string, cellBlocks: BlockJSON[]): TableJSON => ({
    type: 'table',
    attrs: { id },
    content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: cellBlocks }] }],
  })

  it('recurses into a tab panel and reports the modified leaf as a child', () => {
    const before: ArticleNodeJSON[] = [tabs('t1', [block('leaf', 'before')])]
    const after: ArticleNodeJSON[] = [tabs('t1', [block('leaf', 'after')])]
    const { blocks, stats } = diffBlocks(before, after)

    expect(blocks).toHaveLength(1)
    const diff = expectAt(blocks, 0)
    expect(diff.status).toBe('modified')
    expect(diff.children?.map((c) => [c.status, c.id])).toEqual([['modified', 'leaf']])
    // The container itself defers to its children for counting.
    expect(stats.modified).toBe(1)
  })

  it('recurses into an accordion panel', () => {
    const before: ArticleNodeJSON[] = [accordion('ac', [block('x', 'old')])]
    const after: ArticleNodeJSON[] = [accordion('ac', [block('x', 'new')])]
    const { blocks } = diffBlocks(before, after)
    const diff = expectAt(blocks, 0)
    expect(expectAt(diff.children ?? [], 0).status).toBe('modified')
  })

  it('recurses into a table cell', () => {
    const before: ArticleNodeJSON[] = [table('tbl', [block('cellblk', 'v1')])]
    const after: ArticleNodeJSON[] = [table('tbl', [block('cellblk', 'v2')])]
    const { blocks } = diffBlocks(before, after)
    const diff = expectAt(blocks, 0)
    expect(diff.status).toBe('modified')
    expect(diff.children?.map((c) => [c.status, c.id])).toEqual([['modified', 'cellblk']])
  })
})

describe('diffBlockList — single slot (cell / panel)', () => {
  it('diffs a flat block list keeping removed blocks in place', () => {
    const before: BlockJSON[] = [block('a', 'keep'), block('b', 'drop'), block('c', 'edit me')]
    const after: BlockJSON[] = [block('a', 'keep'), block('c', 'edited')]
    const diffs = diffBlockList(before, after)

    expect(diffs.map((d) => [d.status, d.id])).toEqual([
      ['unchanged', 'a'],
      ['removed', 'b'],
      ['modified', 'c'],
    ])
    // The removed block carries its old side; the modified one carries inline spans.
    expect(expectAt(diffs, 1).block).toMatchObject({ attrs: { id: 'b' } })
    expect(expectAt(diffs, 2).inline?.some((s) => s.type === 'ins' && s.text === 'edited')).toBe(
      true
    )
  })

  it('treats null / empty slot content as an empty list', () => {
    expect(diffBlockList(null, [block('a')]).map((d) => d.status)).toEqual(['added'])
    expect(diffBlockList([block('a')], undefined).map((d) => d.status)).toEqual(['removed'])
    expect(diffBlockList(null, null)).toEqual([])
  })
})

describe('inline diff helpers', () => {
  it('flattens visible text including hard breaks', () => {
    expect(
      inlineToText([
        { type: 'text', text: 'line one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'line two' },
      ])
    ).toBe('line one\nline two')
    expect(inlineToText(undefined)).toBe('')
  })

  it('returns no spans for identical text', () => {
    expect(diffInline([{ type: 'text', text: 'same' }], [{ type: 'text', text: 'same' }])).toEqual(
      []
    )
  })

  it('produces word-level (not char-level) spans', () => {
    const spans = diffInline(
      [{ type: 'text', text: 'hello world' }],
      [{ type: 'text', text: 'hello there' }]
    )
    // 'world' replaced by 'there' as whole tokens, not a 'w→t' char edit.
    expect(spans.some((s) => s.type === 'del' && s.text === 'world')).toBe(true)
    expect(spans.some((s) => s.type === 'ins' && s.text === 'there')).toBe(true)
  })
})

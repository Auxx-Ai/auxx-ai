// packages/lib/src/ai/kopilot/capabilities/kb/tools/__tests__/plan-markdown-replace.test.ts

import { describe, expect, it } from 'vitest'
import { mdToBlocks } from '../../../../../../kb/markdown/md-to-blocks'
import type { ArticleNodeJSON, BlockJSON } from '../../../../../../kb/markdown/types'
import { planMarkdownReplace } from '../replace-plan'

const TARGET = 'blk_target'

describe('planMarkdownReplace', () => {
  it('zero blocks → a single delete patch (replace-with-nothing = remove)', () => {
    // Empty/whitespace markdown is short-circuited to [] by the caller
    // (runMarkdownReplace); the planner's contract is just "no nodes → delete".
    const patches = planMarkdownReplace(TARGET, [])
    expect(patches).toHaveLength(1)
    const [del] = patches
    expect(del.op).toBe('delete')
    if (del.op !== 'delete') return
    expect(del.blockIds).toEqual([TARGET])
  })

  it('1→1: a single leaf block keeps the target id with no insert op', () => {
    const nodes = mdToBlocks('Just one rewritten paragraph.')
    expect(nodes).toHaveLength(1)

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(1)

    const [replace] = patches
    expect(replace.op).toBe('replace')
    if (replace.op !== 'replace') return
    expect(replace.blockId).toBe(TARGET)
    expect(replace.block.attrs.id).toBe(TARGET)
  })

  it('1→N: first leaf keeps the id, the rest are inserted after it with fresh ids', () => {
    const nodes = mdToBlocks('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
    expect(nodes).toHaveLength(3)

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(2)

    const [replace, insert] = patches
    expect(replace.op).toBe('replace')
    if (replace.op !== 'replace') return
    expect(replace.block.attrs.id).toBe(TARGET)

    expect(insert.op).toBe('insert')
    if (insert.op !== 'insert') return
    expect(insert.anchor).toEqual({ at: 'after', blockId: TARGET })
    expect(insert.blocks).toHaveLength(2)
    // Extras keep their own (non-target) ids so they diff as "added".
    for (const b of insert.blocks as BlockJSON[]) {
      expect(b.attrs.id).toBeTruthy()
      expect(b.attrs.id).not.toBe(TARGET)
    }
  })

  it('container-first: splices the rewrite before the target then deletes it (id churn accepted)', () => {
    const nodes = mdToBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |')
    const first = nodes[0] as ArticleNodeJSON
    expect(first.type).toBe('table')

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(2)

    const [insert, del] = patches
    expect(insert.op).toBe('insert')
    if (insert.op !== 'insert') return
    expect(insert.anchor).toEqual({ at: 'before', blockId: TARGET })

    expect(del.op).toBe('delete')
    if (del.op !== 'delete') return
    expect(del.blockIds).toEqual([TARGET])
  })
})

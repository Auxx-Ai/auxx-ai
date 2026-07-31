// packages/lib/src/ai/kopilot/capabilities/kb/tools/__tests__/plan-markdown-replace.test.ts

import { describe, expect, it } from 'vitest'
import type { ArticlePatch } from '../../../../../../kb/blocks/patch-types'
import { mdToBlocks } from '../../../../../../kb/markdown/md-to-blocks'
import type { BlockJSON } from '../../../../../../kb/markdown/types'
import { planMarkdownReplace } from '../replace-plan'

const TARGET = 'blk_target'

/**
 * Narrow the patch at `index` to the arm named by `op`, throwing when the
 * plan produced a shorter sequence or a different op — the assertion and the
 * `ArticlePatch` discriminated-union narrowing in one step.
 */
function patchAt<TOp extends ArticlePatch['op']>(
  patches: ArticlePatch[],
  index: number,
  op: TOp
): Extract<ArticlePatch, { op: TOp }> {
  const patch = patches[index]
  if (!patch) throw new Error(`expected a patch at index ${index}, got ${patches.length} patches`)
  if (patch.op !== op) throw new Error(`expected patch ${index} to be "${op}", got "${patch.op}"`)
  return patch as Extract<ArticlePatch, { op: TOp }>
}

describe('planMarkdownReplace', () => {
  it('zero blocks → a single delete patch (replace-with-nothing = remove)', () => {
    // Empty/whitespace markdown is short-circuited to [] by the caller
    // (runMarkdownReplace); the planner's contract is just "no nodes → delete".
    const patches = planMarkdownReplace(TARGET, [])
    expect(patches).toHaveLength(1)
    expect(patchAt(patches, 0, 'delete').blockIds).toEqual([TARGET])
  })

  it('1→1: a single leaf block keeps the target id with no insert op', () => {
    const nodes = mdToBlocks('Just one rewritten paragraph.')
    expect(nodes).toHaveLength(1)

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(1)

    const replace = patchAt(patches, 0, 'replace')
    expect(replace.blockId).toBe(TARGET)
    expect(replace.block.attrs.id).toBe(TARGET)
  })

  it('1→N: first leaf keeps the id, the rest are inserted after it with fresh ids', () => {
    const nodes = mdToBlocks('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
    expect(nodes).toHaveLength(3)

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(2)

    expect(patchAt(patches, 0, 'replace').block.attrs.id).toBe(TARGET)

    const insert = patchAt(patches, 1, 'insert')
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
    expect(nodes[0]?.type).toBe('table')

    const patches = planMarkdownReplace(TARGET, nodes)
    expect(patches).toHaveLength(2)

    expect(patchAt(patches, 0, 'insert').anchor).toEqual({ at: 'before', blockId: TARGET })
    expect(patchAt(patches, 1, 'delete').blockIds).toEqual([TARGET])
  })
})

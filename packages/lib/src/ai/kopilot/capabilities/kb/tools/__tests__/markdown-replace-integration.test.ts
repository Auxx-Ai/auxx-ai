// packages/lib/src/ai/kopilot/capabilities/kb/tools/__tests__/markdown-replace-integration.test.ts
//
// End-to-end (minus db/realtime): markdown → planMarkdownReplace → the REAL
// applyPatch engine, run in sequence the same way runPatchSequence does. Proves
// the splice produces the right document AND that diffBlocks still classifies a
// rewrite as "modified" (the diff guarantee the whole redesign rests on).

import { describe, expect, it } from 'vitest'
import { applyPatch, diffBlocks } from '../../../../../../kb/blocks'
import { createBlockIdAllocator, reassignIds } from '../../../../../../kb/markdown/block-id'
import { mdToBlocks } from '../../../../../../kb/markdown/md-to-blocks'
import type { ArticleNodeJSON, BlockJSON } from '../../../../../../kb/markdown/types'
import { planMarkdownReplace } from '../replace-plan'

/**
 * Apply a planned replace the way runBlockCrudOp does — sequential splices,
 * re-stamping each `insert` op's blocks above the current doc max (so freshly
 * parsed `b1…` ids can't collide with ids already in the doc).
 */
function runReplace(doc: ArticleNodeJSON[], blockId: string, markdown: string): ArticleNodeJSON[] {
  // Mirror runMarkdownReplace: empty/whitespace → zero nodes → delete.
  const nodes = markdown.trim() === '' ? [] : mdToBlocks(markdown)
  const patches = planMarkdownReplace(blockId, nodes)
  let content = doc
  for (const patch of patches) {
    const effective =
      patch.op === 'insert'
        ? { ...patch, blocks: reassignIds(patch.blocks, createBlockIdAllocator(content)) }
        : patch
    content = applyPatch(content, effective).content
  }
  return content
}

/** Every block/panel/container id in a body, for uniqueness assertions. */
function allIds(content: ArticleNodeJSON[]): string[] {
  const ids: string[] = []
  for (const node of content) {
    if (node.type === 'block') ids.push(node.attrs.id ?? '')
    else if (node.type === 'tabs' || node.type === 'accordion') {
      ids.push(node.attrs.id ?? '')
      for (const p of node.content) {
        ids.push(p.attrs.id)
        for (const b of p.content) ids.push(b.attrs.id ?? '')
      }
    } else {
      ids.push(node.attrs?.id ?? '')
      for (const r of node.content)
        for (const c of r.content)
          for (const b of c.content) {
            ids.push(b.attrs.id ?? '')
          }
    }
  }
  return ids
}

const para = (id: string, text: string): BlockJSON => ({
  type: 'block',
  attrs: { id, blockType: 'text' },
  content: [{ type: 'text', text }],
})

const textOf = (node: ArticleNodeJSON): string =>
  node.type === 'block' ? (node.content ?? []).map((n) => n.text ?? '').join('') : `<${node.type}>`

/** The node at `index`, asserted to be a leaf `block` (not a container). */
const blockAt = (content: ArticleNodeJSON[], index: number): BlockJSON => {
  const node = content[index]
  if (node?.type !== 'block') throw new Error(`expected a block at index ${index}`)
  return node
}

/** The node at `index`, asserted to exist. */
const nodeAt = (content: ArticleNodeJSON[], index: number): ArticleNodeJSON => {
  const node = content[index]
  if (!node) throw new Error(`expected a node at index ${index}`)
  return node
}

describe('markdown replace_block — pipeline integration', () => {
  it('1→1: replaces content in place, preserves the id, leaves siblings alone', () => {
    const doc = [para('a', 'first'), para('b', 'OLD body'), para('c', 'third')]
    const next = runReplace(doc, 'b', 'NEW body with **bold**.')

    expect(next.map((n) => n.type === 'block' && n.attrs.id)).toEqual(['a', 'b', 'c'])
    expect(textOf(nodeAt(next, 1))).toBe('NEW body with bold.')

    // The diff guarantee: 'b' shows as modified, not removed+added.
    const { stats, blocks } = diffBlocks(doc, next)
    expect(stats).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 })
    expect(blocks.find((d) => d.id === 'b')?.status).toBe('modified')
  })

  it('1→N: first block keeps the id, extras are inserted right after with fresh ids', () => {
    const doc = [para('a', 'first'), para('b', 'OLD'), para('c', 'third')]
    const next = runReplace(doc, 'b', 'One.\n\nTwo.\n\nThree.')

    const ids = next.map((n) => (n.type === 'block' ? n.attrs.id : null))
    expect(ids[0]).toBe('a')
    expect(ids[1]).toBe('b') // first rewritten block inherits the target id
    expect(ids[4]).toBe('c')
    expect(next.map(textOf)).toEqual(['first', 'One.', 'Two.', 'Three.', 'third'])

    // Extras carry NEW unique ids (not 'b', not each other).
    const extraIds = [ids[2], ids[3]]
    expect(new Set([...extraIds, 'b']).size).toBe(3)

    // Diff: 'b' modified, two extras added — exactly the plan's stated outcome.
    const { stats } = diffBlocks(doc, next)
    expect(stats).toEqual({ added: 2, removed: 0, modified: 1, moved: 0 })
  })

  it('empty markdown removes the target block and leaves the rest intact', () => {
    const doc = [para('a', 'keep'), para('b', 'remove me'), para('c', 'keep too')]
    const next = runReplace(doc, 'b', '')

    expect(next.map((n) => n.type === 'block' && n.attrs.id)).toEqual(['a', 'c'])
    const { stats } = diffBlocks(doc, next)
    expect(stats).toEqual({ added: 0, removed: 1, modified: 0, moved: 0 })
  })

  it('rewrites a paragraph into a callout, keeping the id', () => {
    const doc = [para('a', 'intro'), para('b', 'plain warning text')]
    const next = runReplace(doc, 'b', ':::warn\nBack up before upgrading.\n:::')

    const callout = blockAt(next, 1)
    expect(callout.attrs.id).toBe('b')
    expect(callout.attrs.blockType).toBe('callout')
    expect(callout.attrs.calloutVariant).toBe('warn')
  })

  it('container-first: paragraph → table splices in and drops the original (id churns)', () => {
    const doc = [para('a', 'intro'), para('b', 'turn me into a table'), para('c', 'outro')]
    const next = runReplace(doc, 'b', '| h1 | h2 |\n| --- | --- |\n| 1 | 2 |')

    expect(next.map((n) => n.type)).toEqual(['block', 'table', 'block'])
    expect(next.map((n) => (n.type === 'block' ? n.attrs.id : 'table'))).toEqual([
      'a',
      'table',
      'c',
    ])
    // 'b' is gone — the table is a fresh node (documented type-change id churn).
    expect(next.some((n) => n.type === 'block' && n.attrs.id === 'b')).toBe(false)
  })

  it('1→N into a b-id doc: re-stamped extras never collide with existing ids', () => {
    // The doc already uses sequential ids — exactly the case where the parser's
    // fresh `b1…` ids would clash without the insert re-stamp.
    const doc = [para('b1', 'first'), para('b2', 'OLD'), para('b3', 'third')]
    const next = runReplace(doc, 'b2', 'One.\n\nTwo.\n\nThree.')

    const ids = next.map((n) => (n.type === 'block' ? n.attrs.id : null))
    expect(ids[0]).toBe('b1')
    expect(ids[1]).toBe('b2') // first rewritten block inherits the target id
    expect(ids[4]).toBe('b3')
    expect(next.map(textOf)).toEqual(['first', 'One.', 'Two.', 'Three.', 'third'])

    // The two extras are above the doc max and all ids stay unique.
    const all = allIds(next)
    expect(new Set(all).size).toBe(all.length)
    expect(ids[2]).toBe('b4')
    expect(ids[3]).toBe('b5')

    const { stats } = diffBlocks(doc, next)
    expect(stats).toEqual({ added: 2, removed: 0, modified: 1, moved: 0 })
  })

  it('preserves inline @[id] reference tokens through a rewrite', () => {
    const doc = [para('b', 'see the field')]
    const next = runReplace(doc, 'b', 'Current status: @[field:ticket:status] — check it.')

    const block = blockAt(next, 0)
    expect(block.attrs.id).toBe('b')
    const ref = (block.content ?? []).find((n) => n.type === 'reference')
    expect(ref).toBeDefined()
    expect(ref?.attrs?.id).toBe('field:ticket:status')
  })
})

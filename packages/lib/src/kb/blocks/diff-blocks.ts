// packages/lib/src/kb/blocks/diff-blocks.ts
//
// Pure structural diff of two article bodies (`ArticleNodeJSON[]`). Block ids
// are stable across versions (publish/restore copy `contentJson` verbatim), so
// the diff is keyed on `attrs.id`: an id present on both sides with differing
// content is `modified`; LCS over the id sequences classifies reorders as
// `moved` and keeps removed blocks in their old position for rendering.
//
// Reused by the version diff (Phase 3) and the Kopilot turn review (Phase 5).
// Must stay pure (types + ./inline-diff only) so client code can import it.

import type { ArticleNodeJSON, BlockJSON, ContainerBlockJSON } from '../markdown/types'
import { diffInline, type InlineDiffSpan } from './inline-diff'

export type BlockDiffStatus = 'added' | 'removed' | 'modified' | 'moved' | 'unchanged'

export interface BlockDiff {
  status: BlockDiffStatus
  id: string // attrs.id (stable across versions)
  block: ArticleNodeJSON // new side; old side when status === 'removed'
  prevBlock?: ArticleNodeJSON // present for 'modified' | 'moved'
  inline?: InlineDiffSpan[] // word-level, leaf 'modified'/'moved' only
  children?: BlockDiff[] // recursion for modified containers (tabs/accordion/table)
}

export interface ArticleDiff {
  blocks: BlockDiff[]
  stats: { added: number; removed: number; modified: number; moved: number }
}

/**
 * Diff two article bodies into a renderable `ArticleDiff`. `null`/`undefined`
 * is treated as an empty body.
 */
export function diffBlocks(
  oldContent: ArticleNodeJSON[] | null | undefined,
  newContent: ArticleNodeJSON[] | null | undefined
): ArticleDiff {
  const blocks = diffLevel(oldContent ?? [], newContent ?? [])
  const stats = { added: 0, removed: 0, modified: 0, moved: 0 }
  tally(blocks, stats)
  return { blocks, stats }
}

/**
 * Diff two flat block lists — the contents of a single table cell or a
 * tab/accordion panel — into ordered `BlockDiff`s. Same engine as the
 * top-level diff (LCS over stable ids, word-level inline diff on modified
 * leaves), exposed so container-internal rendering can rebuild a slot's
 * before/after sequence with removed blocks reinserted in place.
 */
export function diffBlockList(
  oldBlocks: ArticleNodeJSON[] | null | undefined,
  newBlocks: ArticleNodeJSON[] | null | undefined
): BlockDiff[] {
  return diffLevel(oldBlocks ?? [], newBlocks ?? [])
}

// ─── core ────────────────────────────────────────────────────────────

function diffLevel(oldNodes: ArticleNodeJSON[], newNodes: ArticleNodeJSON[]): BlockDiff[] {
  const oldIds = oldNodes.map(nodeId)
  const newIds = newNodes.map(nodeId)
  const oldMap = new Map(oldNodes.map((n, i) => [oldIds[i], n]))
  const newMap = new Map(newNodes.map((n, i) => [newIds[i], n]))
  const lcs = lcsIds(oldIds, newIds)

  const result: BlockDiff[] = []
  let oi = 0
  let nj = 0
  let li = 0

  while (oi < oldNodes.length || nj < newNodes.length) {
    const anchor = li < lcs.length ? lcs[li] : undefined
    const oldNode = oldNodes[oi]
    const oldId = oldIds[oi]
    const newNode = newNodes[nj]
    const newId = newIds[nj]

    // Old block that isn't the next stable anchor → removed, or the source
    // slot of a moved block (emitted at its new position, so skip here).
    if (oldNode && oldId !== undefined && oldId !== anchor) {
      if (newMap.has(oldId)) {
        oi++
        continue
      }
      result.push({ status: 'removed', id: oldId, block: oldNode })
      oi++
      continue
    }

    // New block that isn't the next anchor → added, or a moved block's
    // destination (present on both sides but out of stable order).
    if (newNode && newId !== undefined && newId !== anchor) {
      const prev = oldMap.get(newId)
      if (prev) {
        result.push(classify(prev, newNode, true))
        nj++
        continue
      }
      result.push({ status: 'added', id: newId, block: newNode })
      nj++
      continue
    }

    // Both sit on the stable anchor.
    if (anchor !== undefined && oldNode && newNode) {
      result.push(classify(oldNode, newNode, false))
      oi++
      nj++
      li++
      continue
    }
    break
  }

  return result
}

function classify(oldNode: ArticleNodeJSON, newNode: ArticleNodeJSON, moved: boolean): BlockDiff {
  const id = nodeId(newNode)
  if (isEqualNode(oldNode, newNode)) {
    return moved
      ? { status: 'moved', id, block: newNode, prevBlock: oldNode }
      : { status: 'unchanged', id, block: newNode }
  }

  const status: BlockDiffStatus = moved ? 'moved' : 'modified'

  // Leaf block changed → word-level inline diff.
  if (oldNode.type === 'block' && newNode.type === 'block') {
    return {
      status,
      id,
      block: newNode,
      prevBlock: oldNode,
      inline: diffInline(oldNode.content, newNode.content),
    }
  }

  // Container of the same kind changed → recurse over its leaf blocks.
  if (isContainer(oldNode) && isContainer(newNode) && oldNode.type === newNode.type) {
    return {
      status,
      id,
      block: newNode,
      prevBlock: oldNode,
      children: diffLevel(collectLeaves(oldNode), collectLeaves(newNode)),
    }
  }

  // Type changed across the same id (rare) — surface as a plain modified frame.
  return { status, id, block: newNode, prevBlock: oldNode }
}

// ─── helpers ─────────────────────────────────────────────────────────

function nodeId(node: ArticleNodeJSON): string {
  return (node.type === 'block' ? node.attrs.id : node.attrs?.id) ?? ''
}

function isContainer(node: ArticleNodeJSON): node is ContainerBlockJSON {
  return node.type !== 'block'
}

/** Leaf blocks held inside a container, in document order. */
function collectLeaves(node: ContainerBlockJSON): BlockJSON[] {
  if (node.type === 'tabs' || node.type === 'accordion') {
    return node.content.flatMap((panel) => panel.content)
  }
  return node.content.flatMap((row) => row.content.flatMap((cell) => cell.content))
}

const VOLATILE_KEYS = new Set(['codeHighlightedHtml'])

/** Structural deep-equal, ignoring derived keys and key order. */
function isEqualNode(a: ArticleNodeJSON, b: ArticleNodeJSON): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Longest common subsequence of two id sequences (unique ids per doc). */
function lcsIds(a: string[], b: string[]): string[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const nextRow = dp[i + 1]
    if (!row || !nextRow) throw new Error('invalid LCS table')
    for (let j = m - 1; j >= 0; j--) {
      const next = nextRow[j + 1] ?? 0
      const below = nextRow[j] ?? 0
      const right = row[j + 1] ?? 0
      row[j] = a[i] === b[j] ? next + 1 : Math.max(below, right)
    }
  }
  const seq: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const aId = a[i]
    const bId = b[j]
    if (aId === undefined || bId === undefined) break
    if (aId === bId) {
      seq.push(aId)
      i++
      j++
    } else {
      const below = dp[i + 1]?.[j] ?? 0
      const right = dp[i]?.[j + 1] ?? 0
      if (below >= right) {
        i++
      } else {
        j++
      }
    }
  }
  return seq
}

/** Count changed leaves of the diff tree (a modified container defers to its children). */
function tally(diffs: BlockDiff[], stats: ArticleDiff['stats']): void {
  for (const d of diffs) {
    if (d.children && d.children.length > 0) {
      tally(d.children, stats)
      continue
    }
    if (d.status === 'added') stats.added++
    else if (d.status === 'removed') stats.removed++
    else if (d.status === 'modified') stats.modified++
    else if (d.status === 'moved') stats.moved++
  }
}

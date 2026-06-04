// packages/lib/src/kb/markdown/block-id.ts
//
// Sequential, per-article block-id allocation. The addressable nodes in a KB
// article body (`block`, `panel`, and the containers `tabs` / `accordion` /
// `table`) carry a short `attrs.id` like `b1`, `b2`, … instead of a random
// nanoid. Ids only need to be unique WITHIN a single article body (patch
// addressing, the version/turn diff, and CAS hashing are all article-scoped),
// so a per-document auto-increment is sufficient and far easier for an agent
// to echo back than a 21-char random string.
//
// The id is a database-style high-water-mark: existing ids are preserved and
// new ids are allocated strictly above the current max, so the diff's
// "ids are stable across versions" contract holds (see diff-blocks.ts). Gaps
// from deletes are fine — numbers are never reused.
//
// Pure module (only `@auxx/utils` + local types) so the editor and `@auxx/ui`
// can import it client-side.

import { createIdAllocator } from '@auxx/utils'
import type { ArticleNodeJSON, BlockJSON, PanelJSON } from './types'

/** Prefix on every generated block/panel/container id. */
export const BLOCK_ID_PREFIX = 'b'

const SEQ_RE = /^b(\d+)$/

/**
 * Parse the numeric part of a sequential block id, or `null` if the id isn't
 * in `b<number>` form (e.g. a legacy nanoid, an empty string, or undefined).
 * Used to seed allocators above the current max and to ignore non-sequential
 * ids when computing it.
 */
export function blockIdNumber(id: string | null | undefined): number | null {
  if (!id) return null
  const m = SEQ_RE.exec(id)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Highest sequential id number used anywhere in a document body — top-level
 * blocks and containers, panel ids and their child blocks, and table cell
 * blocks. Returns 0 when the body has no sequential ids (e.g. empty, or all
 * legacy nanoids). Non-sequential ids are ignored; they can never collide with
 * a `b<number>` so they don't constrain the next number.
 */
export function maxBlockNumber(content: ArticleNodeJSON[]): number {
  let max = 0
  const consider = (id: string | null | undefined) => {
    const n = blockIdNumber(id)
    if (n !== null && n > max) max = n
  }
  const walkBlock = (block: BlockJSON) => consider(block.attrs?.id)
  const walkPanel = (panel: PanelJSON) => {
    consider(panel.attrs?.id)
    for (const b of panel.content ?? []) walkBlock(b)
  }
  for (const node of content) {
    if (node.type === 'block') {
      walkBlock(node)
    } else if (node.type === 'tabs' || node.type === 'accordion') {
      consider(node.attrs?.id)
      for (const panel of node.content) walkPanel(panel)
    } else {
      // table
      consider(node.attrs?.id)
      for (const row of node.content) {
        for (const cell of row.content) {
          for (const b of cell.content) walkBlock(b)
        }
      }
    }
  }
  return max
}

/**
 * An id allocator seeded above a document's current max, so every id it hands
 * out is unique within that document. Use it to mint ids for new nodes being
 * added to (or spliced into) an existing body.
 */
export function createBlockIdAllocator(content: ArticleNodeJSON[]): () => string {
  return createIdAllocator(BLOCK_ID_PREFIX, maxBlockNumber(content))
}

/**
 * Return a deep copy of `nodes` with a FRESH id forced onto every block,
 * panel, and container (table/tabs/accordion). Unlike `stampBlockIds` — which
 * preserves existing ids — this reassigns unconditionally, so it's the right
 * tool when nodes are being introduced into a document and must not collide
 * with what's already there (markdown parse output, an insert splice). Seed
 * `nextId` with {@link createBlockIdAllocator} of the target document.
 */
export function reassignIds(nodes: ArticleNodeJSON[], nextId: () => string): ArticleNodeJSON[] {
  const stampBlock = (block: BlockJSON): BlockJSON => ({
    ...block,
    attrs: { ...block.attrs, id: nextId() },
  })
  const stampPanel = (panel: PanelJSON): PanelJSON => ({
    ...panel,
    attrs: { ...panel.attrs, id: nextId() },
    content: (panel.content ?? []).map(stampBlock),
  })
  return nodes.map((node): ArticleNodeJSON => {
    if (node.type === 'block') return stampBlock(node)
    if (node.type === 'tabs' || node.type === 'accordion') {
      return {
        ...node,
        attrs: { ...node.attrs, id: nextId() },
        content: node.content.map(stampPanel),
      }
    }
    // table
    return {
      ...node,
      attrs: { ...node.attrs, id: nextId() },
      content: node.content.map((row) => ({
        ...row,
        content: row.content.map((cell) => ({ ...cell, content: cell.content.map(stampBlock) })),
      })),
    }
  })
}

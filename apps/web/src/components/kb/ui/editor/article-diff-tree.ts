// apps/web/src/components/kb/ui/editor/article-diff-tree.ts
//
// Turns the structural `BlockDiff[]` from `@auxx/lib/kb/blocks` into a render
// plan for `<ArticleDiffView>`. Top-level text blocks get their word diff baked
// into inline content (ins → highlight, del → strike). Modified containers
// (tabs/accordion/table) are reconstructed: each panel/cell is re-diffed so
// container-nested changes show inline — modified text carries its word diff,
// added blocks stay, and removed blocks are reinserted in place — and every
// nested leaf's status is recorded in a `decorations` map the renderer reads to
// border-decorate it.

import { type BlockDiff, diffBlockList, type InlineDiffSpan } from '@auxx/lib/kb/blocks'
import type {
  ArticleNodeJSON,
  BlockJSON,
  DiffStatus,
  InlineJSON,
  PanelJSON,
  TableRowJSON,
} from '@auxx/ui/components/kb/article'

/** Block types whose visible text we rebuild from the word diff. */
const TEXT_BLOCK_TYPES = new Set([
  'text',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'todoListItem',
  'quote',
  'callout',
])

export interface DiffRenderResult {
  /**
   * One entry per top-level diff entry, each pairing the diff with the node to
   * render for it (containers reconstructed with inner diffs baked in). Paired
   * rather than two parallel arrays so the 1:1 relation holds by construction.
   */
  entries: Array<{ diff: BlockDiff; node: ArticleNodeJSON }>
  /** Container-nested leaf id → status, consumed by the renderer for border decoration. */
  decorations: Map<string, DiffStatus>
}

/** Build the render plan for a top-level article diff. */
export function buildDiffRender(blocks: BlockDiff[]): DiffRenderResult {
  const decorations = new Map<string, DiffStatus>()
  const entries = blocks.map((diff) => ({ diff, node: toRenderNode(diff, decorations) }))
  return { entries, decorations }
}

/**
 * The node to render for a top-level diff entry. Modified text blocks get their
 * inline content rebuilt from the word diff; modified containers are
 * reconstructed (and populate `decorations`); everything else renders its own
 * side verbatim (`block` is the new side, or the old side for removals).
 */
function toRenderNode(diff: BlockDiff, decorations: Map<string, DiffStatus>): ArticleNodeJSON {
  const node = diff.block as ArticleNodeJSON
  const prev = diff.prevBlock as ArticleNodeJSON | undefined

  if (diff.status === 'modified' || diff.status === 'moved') {
    if (
      node.type === 'block' &&
      diff.inline?.length &&
      TEXT_BLOCK_TYPES.has(node.attrs.blockType)
    ) {
      return withDiffInline(node, diff.inline)
    }
    if (prev && node.type !== 'block' && prev.type === node.type) {
      return reconstructContainer(prev, node, decorations)
    }
  }
  return node
}

/** Rebuild a modified container so its nested leaf diffs render inline. */
function reconstructContainer(
  oldNode: ArticleNodeJSON,
  newNode: ArticleNodeJSON,
  decorations: Map<string, DiffStatus>
): ArticleNodeJSON {
  if (newNode.type === 'tabs' && oldNode.type === 'tabs') {
    return { ...newNode, content: mergePanels(oldNode.content, newNode.content, decorations) }
  }
  if (newNode.type === 'accordion' && oldNode.type === 'accordion') {
    return { ...newNode, content: mergePanels(oldNode.content, newNode.content, decorations) }
  }
  if (newNode.type === 'table' && oldNode.type === 'table') {
    return { ...newNode, content: mergeRows(oldNode.content, newNode.content, decorations) }
  }
  return newNode
}

// ─── tabs / accordion ────────────────────────────────────────────────

/** Pair panels by stable id; re-diff each panel's blocks, keep removed panels visible. */
function mergePanels(
  oldPanels: PanelJSON[],
  newPanels: PanelJSON[],
  decorations: Map<string, DiffStatus>
): PanelJSON[] {
  const oldById = new Map(oldPanels.map((p) => [p.attrs.id, p]))
  const newIds = new Set(newPanels.map((p) => p.attrs.id))

  const result: PanelJSON[] = newPanels.map((panel) => ({
    ...panel,
    content: mergeBlocks(
      diffBlockList(oldById.get(panel.attrs.id)?.content, panel.content),
      decorations
    ),
  }))

  // Whole panels removed on the new side: reinsert at their old position with
  // all their blocks flagged removed.
  oldPanels.forEach((panel, i) => {
    if (newIds.has(panel.attrs.id)) return
    result.splice(Math.min(i, result.length), 0, {
      ...panel,
      content: markAll(panel.content, 'removed', decorations),
    })
  })

  return result
}

// ─── table ───────────────────────────────────────────────────────────

/** Tables are grids: pair rows and cells positionally, re-diffing each cell's blocks. */
function mergeRows(
  oldRows: TableRowJSON[],
  newRows: TableRowJSON[],
  decorations: Map<string, DiffStatus>
): TableRowJSON[] {
  const result: TableRowJSON[] = newRows.map((row, ri) => {
    const oldRow = oldRows[ri]
    return {
      ...row,
      content: row.content.map((cell, ci) => ({
        ...cell,
        content: mergeBlocks(
          diffBlockList(oldRow?.content[ci]?.content, cell.content),
          decorations
        ),
      })),
    }
  })

  // Rows removed on the new side (old table had more rows): reinsert, all removed.
  for (const oldRow of oldRows.slice(newRows.length)) {
    result.push({
      ...oldRow,
      content: oldRow.content.map((cell) => ({
        ...cell,
        content: markAll(cell.content, 'removed', decorations),
      })),
    })
  }

  return result
}

// ─── leaf merge ──────────────────────────────────────────────────────

/**
 * Turn a slot's `BlockDiff[]` into the blocks to render: modified text carries
 * its word diff, removed blocks are kept in place, and each changed leaf's id
 * is recorded in `decorations` for border styling. `diff.block` is the new side
 * (or the old side for removals).
 */
function mergeBlocks(diffs: BlockDiff[], decorations: Map<string, DiffStatus>): BlockJSON[] {
  const out: BlockJSON[] = []
  for (const d of diffs) {
    const block = d.block as BlockJSON
    const id = block.type === 'block' ? block.attrs.id : undefined

    switch (d.status) {
      case 'added':
      case 'removed':
        out.push(block)
        if (id) decorations.set(id, d.status)
        break
      case 'modified':
        out.push(diffInlineNode(block, d.inline))
        if (id) decorations.set(id, 'modified')
        break
      case 'moved':
        // A pure reorder gets no inline change; only flag/bake when text edited too.
        if (d.inline?.length) {
          out.push(diffInlineNode(block, d.inline))
          if (id) decorations.set(id, 'modified')
        } else {
          out.push(block)
        }
        break
      default:
        out.push(block)
    }
  }
  return out
}

/** Bake the word diff into a text block; leave non-text blocks untouched. */
function diffInlineNode(block: BlockJSON, inline: InlineDiffSpan[] | undefined): BlockJSON {
  if (inline?.length && TEXT_BLOCK_TYPES.has(block.attrs.blockType)) {
    return withDiffInline(block, inline)
  }
  return block
}

/** Flag every block in a list with one status (used for wholly removed panels/rows). */
function markAll(
  blocks: BlockJSON[],
  status: DiffStatus,
  decorations: Map<string, DiffStatus>
): BlockJSON[] {
  for (const block of blocks) {
    if (block.attrs?.id) decorations.set(block.attrs.id, status)
  }
  return blocks
}

// ─── inline rebuild ──────────────────────────────────────────────────

function withDiffInline(block: BlockJSON, spans: InlineDiffSpan[]): BlockJSON {
  return { ...block, content: spansToInline(spans) }
}

function spansToInline(spans: InlineDiffSpan[]): InlineJSON[] {
  return spans
    .filter((s) => s.text.length > 0)
    .map((s) =>
      s.type === 'eq'
        ? { type: 'text', text: s.text }
        : {
            type: 'text',
            text: s.text,
            marks: [{ type: s.type === 'ins' ? 'highlight' : 'strike' }],
          }
    )
}

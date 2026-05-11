// packages/lib/src/kb/blocks/apply-patch.ts

import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  PanelJSON,
  TableJSON,
  TabsJSON,
} from '../markdown/types'
import type { ArticlePatch, BlockAnchor, PatchEffect } from './patch-types'

/**
 * Pure splice: applies an `ArticlePatch` to a document body and returns
 * a new body plus a summary of which block ids were affected.
 *
 * Invariants & assumptions:
 * - Every block (BlockJSON) and every panel (PanelJSON) has an id on
 *   `attrs.id` (`stampBlockIds` upstream guarantees this).
 * - Block ids are unique across the doc; same for panel ids.
 * - Block-level mutations operate at the level where the target id lives:
 *   top-level, inside a panel, or inside a table cell.
 *
 * Validation failures throw `PatchError`. The caller decides whether to
 * translate that into a tool-result error or retry.
 */
export class PatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'block_not_found'
      | 'container_not_found'
      | 'invalid_anchor'
      | 'invalid_block'
      | 'duplicate_id'
  ) {
    super(message)
    this.name = 'PatchError'
  }
}

export interface ApplyPatchResult {
  content: ArticleNodeJSON[]
  effect: PatchEffect
}

export function applyPatch(content: ArticleNodeJSON[], patch: ArticlePatch): ApplyPatchResult {
  switch (patch.op) {
    case 'insert':
      return applyInsert(content, patch.anchor, patch.blocks)
    case 'replace':
      return applyReplace(content, patch.blockId, patch.block)
    case 'updateText':
      return applyUpdateText(content, patch.blockId, patch.content)
    case 'updateAttrs':
      return applyUpdateAttrs(content, patch.blockId, patch.attrs)
    case 'delete':
      return applyDelete(content, patch.blockIds)
    case 'move':
      return applyMove(content, patch.blockIds, patch.anchor)
  }
}

// ─── op handlers ─────────────────────────────────────────────────────

function applyInsert(
  content: ArticleNodeJSON[],
  anchor: BlockAnchor,
  blocks: ArticleNodeJSON[]
): ApplyPatchResult {
  if (blocks.length === 0) {
    return { content, effect: { op: 'insert', blockIds: [] } }
  }
  const next = spliceAtAnchor(content, anchor, blocks)
  return {
    content: next,
    effect: {
      op: 'insert',
      blockIds: blocks.map((b) => (b.type === 'block' ? (b.attrs.id ?? '') : '')).filter(Boolean),
    },
  }
}

function assertOnlyLeafBlocks(
  blocks: ArticleNodeJSON[],
  where: string
): asserts blocks is BlockJSON[] {
  if (blocks.some((b) => b.type !== 'block')) {
    throw new PatchError(
      `containers (table/tabs/accordion) cannot be inserted ${where} — panels and table cells hold leaf blocks only`,
      'invalid_block'
    )
  }
}

function applyReplace(
  content: ArticleNodeJSON[],
  blockId: string,
  block: BlockJSON
): ApplyPatchResult {
  const next = mutateBlockById(content, blockId, () => ({
    ...block,
    attrs: { ...block.attrs, id: blockId },
  }))
  return { content: next, effect: { op: 'replace', blockIds: [blockId] } }
}

function applyUpdateText(
  content: ArticleNodeJSON[],
  blockId: string,
  inline: BlockJSON['content']
): ApplyPatchResult {
  const next = mutateBlockById(content, blockId, (existing) => ({
    ...existing,
    content: inline,
  }))
  return { content: next, effect: { op: 'updateText', blockIds: [blockId] } }
}

function applyUpdateAttrs(
  content: ArticleNodeJSON[],
  blockId: string,
  attrs: Partial<BlockJSON['attrs']>
): ApplyPatchResult {
  const { id: _ignored, ...safeAttrs } = attrs as { id?: string }
  const next = mutateBlockById(content, blockId, (existing) => ({
    ...existing,
    attrs: { ...existing.attrs, ...safeAttrs },
  }))
  return { content: next, effect: { op: 'updateAttrs', blockIds: [blockId] } }
}

function applyDelete(content: ArticleNodeJSON[], blockIds: string[]): ApplyPatchResult {
  const idSet = new Set(blockIds)
  const removed = new Set<string>()
  const next = mapBlockArrays(content, (arr) => {
    if (!arr.some((b) => idSet.has(b.attrs.id ?? ''))) return arr
    return arr.filter((b) => {
      const id = b.attrs.id ?? ''
      if (idSet.has(id)) {
        removed.add(id)
        return false
      }
      return true
    })
  })
  // Top-level delete: blocks may live directly in `content` (mixed array).
  let topLevelDeleted = next
  const idsLeft = new Set([...idSet].filter((id) => !removed.has(id)))
  if (idsLeft.size > 0) {
    topLevelDeleted = next.filter((node) => {
      if (node.type !== 'block') return true
      const id = node.attrs.id ?? ''
      if (idsLeft.has(id)) {
        removed.add(id)
        return false
      }
      return true
    })
  }
  const missing = blockIds.filter((id) => !removed.has(id))
  if (missing.length > 0) {
    throw new PatchError(`blocks not found: ${missing.join(', ')}`, 'block_not_found')
  }
  return { content: topLevelDeleted, effect: { op: 'delete', blockIds: [...removed] } }
}

function applyMove(
  content: ArticleNodeJSON[],
  blockIds: string[],
  anchor: BlockAnchor
): ApplyPatchResult {
  if (blockIds.length === 0) {
    return { content, effect: { op: 'move', blockIds: [] } }
  }
  const idSet = new Set(blockIds)
  const plucked = new Map<string, BlockJSON>()
  const sansNested = mapBlockArrays(content, (arr) => {
    if (!arr.some((b) => idSet.has(b.attrs.id ?? ''))) return arr
    const keep: BlockJSON[] = []
    for (const b of arr) {
      const id = b.attrs.id ?? ''
      if (idSet.has(id)) plucked.set(id, b)
      else keep.push(b)
    }
    return keep
  })
  const sansTopLevel = sansNested.filter((node) => {
    if (node.type !== 'block') return true
    const id = node.attrs.id ?? ''
    if (idSet.has(id)) {
      plucked.set(id, node)
      return false
    }
    return true
  })
  if (plucked.size !== idSet.size) {
    const missing = blockIds.filter((id) => !plucked.has(id))
    throw new PatchError(`blocks not found: ${missing.join(', ')}`, 'block_not_found')
  }
  const orderedBlocks = blockIds.map((id) => plucked.get(id)!)
  const next = spliceAtAnchor(sansTopLevel, anchor, orderedBlocks)
  return { content: next, effect: { op: 'move', blockIds: [...blockIds] } }
}

// ─── splice helpers ──────────────────────────────────────────────────

function spliceAtAnchor(
  content: ArticleNodeJSON[],
  anchor: BlockAnchor,
  freshBlocks: ArticleNodeJSON[]
): ArticleNodeJSON[] {
  if (anchor.at === 'start') {
    return [...freshBlocks, ...content]
  }
  if (anchor.at === 'end') {
    return [...content, ...freshBlocks]
  }
  if (anchor.at === 'before' || anchor.at === 'after') {
    const target = anchor.blockId
    const offset = anchor.at === 'before' ? 0 : 1

    // Try top-level first.
    const topIdx = content.findIndex((n) => n.type === 'block' && n.attrs.id === target)
    if (topIdx >= 0) {
      const at = topIdx + offset
      return [...content.slice(0, at), ...freshBlocks, ...content.slice(at)]
    }

    // Nested: find the panel or cell that owns the block. Panels/cells can
    // only hold leaf blocks, so reject containers here.
    assertOnlyLeafBlocks(
      freshBlocks,
      `before/after block '${target}' (nested in a panel or table cell)`
    )
    let placed = false
    const next = mapBlockArrays(content, (arr) => {
      const idx = arr.findIndex((b) => b.attrs.id === target)
      if (idx < 0) return arr
      placed = true
      const at = idx + offset
      return [...arr.slice(0, at), ...freshBlocks, ...arr.slice(at)]
    })
    if (!placed) {
      throw new PatchError(`anchor block '${target}' not found`, 'invalid_anchor')
    }
    return next
  }
  if (anchor.at === 'startOf' || anchor.at === 'endOf') {
    assertOnlyLeafBlocks(freshBlocks, `inside container '${anchor.containerId}'`)
    const containerId = anchor.containerId
    let placed = false
    const next = mapPanels(content, (panel) => {
      if (panel.attrs.id !== containerId) return panel
      placed = true
      const target =
        anchor.at === 'startOf'
          ? [...freshBlocks, ...panel.content]
          : [...panel.content, ...freshBlocks]
      return { ...panel, content: target }
    })
    if (!placed) {
      throw new PatchError(`container '${containerId}' not found`, 'container_not_found')
    }
    return next
  }
  throw new PatchError(`unrecognized anchor`, 'invalid_anchor')
}

/**
 * Locate a block by id and apply a transform to it. Searches top-level
 * blocks, panel children, and table cell children. Throws if the id
 * isn't found anywhere.
 */
function mutateBlockById(
  content: ArticleNodeJSON[],
  blockId: string,
  transform: (existing: BlockJSON) => BlockJSON
): ArticleNodeJSON[] {
  // Top-level
  let foundTop = false
  const topReplaced = content.map((node): ArticleNodeJSON => {
    if (node.type === 'block' && node.attrs.id === blockId) {
      foundTop = true
      return transform(node)
    }
    return node
  })
  if (foundTop) return topReplaced

  // Nested
  let foundNested = false
  const nestedReplaced = mapBlockArrays(content, (arr) => {
    const idx = arr.findIndex((b) => b.attrs.id === blockId)
    if (idx < 0) return arr
    foundNested = true
    const out = [...arr]
    out[idx] = transform(arr[idx])
    return out
  })
  if (!foundNested) {
    throw new PatchError(`block '${blockId}' not found`, 'block_not_found')
  }
  return nestedReplaced
}

/**
 * Walks every NESTED BlockJSON[] (inside panels and table cells) and
 * lets the visitor rewrite it. Top-level `content` is NOT visited here
 * — top-level operations need to operate on the mixed
 * BlockJSON|ContainerBlockJSON array directly to preserve container
 * interleaving.
 */
function mapBlockArrays(
  content: ArticleNodeJSON[],
  visit: (arr: BlockJSON[]) => BlockJSON[]
): ArticleNodeJSON[] {
  let changed = false
  const next = content.map((node): ArticleNodeJSON => {
    if (node.type === 'block') return node
    if (node.type === 'tabs' || node.type === 'accordion') {
      let inner = false
      const panels = node.content.map((panel): PanelJSON => {
        const visited = visit(panel.content)
        if (visited === panel.content) return panel
        inner = true
        return { ...panel, content: visited }
      })
      if (!inner) return node
      changed = true
      return { ...node, content: panels } as TabsJSON | AccordionJSON
    }
    if (node.type === 'table') {
      let inner = false
      const rows = node.content.map((row) => {
        let rowChanged = false
        const cells = row.content.map((cell) => {
          const visited = visit(cell.content)
          if (visited === cell.content) return cell
          rowChanged = true
          return { ...cell, content: visited }
        })
        if (!rowChanged) return row
        inner = true
        return { ...row, content: cells }
      })
      if (!inner) return node
      changed = true
      return { ...node, content: rows } as TableJSON
    }
    return node
  })
  return changed ? next : content
}

/**
 * Walks every panel in the document (inside tabs/accordion) and lets
 * the visitor rewrite it.
 */
function mapPanels(
  content: ArticleNodeJSON[],
  visit: (panel: PanelJSON) => PanelJSON
): ArticleNodeJSON[] {
  let changed = false
  const next = content.map((node): ArticleNodeJSON => {
    if (node.type !== 'tabs' && node.type !== 'accordion') return node
    let inner = false
    const panels = node.content.map((panel) => {
      const v = visit(panel)
      if (v !== panel) inner = true
      return v
    })
    if (!inner) return node
    changed = true
    return { ...node, content: panels } as TabsJSON | AccordionJSON
  })
  return changed ? next : content
}

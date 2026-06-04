// packages/lib/src/kb/markdown/stamp-ids.ts

import { createBlockIdAllocator } from './block-id'
import type { ArticleNodeJSON, BlockJSON, ContainerBlockJSON, PanelJSON } from './types'

/**
 * Walks an article body and ensures every `block` and `panel` node has a
 * stable id on `attrs.id`. Existing ids are preserved; missing or
 * duplicate ids are replaced with fresh ones. Returns a new array — the
 * input is not mutated.
 *
 * The canonical invariant for KB articles is "every block has an id".
 * Use this whenever we accept content from a path that might predate
 * the invariant (legacy persisted articles, agent-supplied JSON, etc).
 *
 * Fresh ids are short sequential `b<n>` values allocated above the body's
 * current max (high-water-mark), so existing ids are never renumbered and
 * the diff's "stable across versions" contract holds. Idempotent: a body
 * with unique ids comes back `changed: false`, byte-identical.
 */
export function stampBlockIds(content: ArticleNodeJSON[]): {
  content: ArticleNodeJSON[]
  changed: boolean
} {
  const seen = new Set<string>()
  const nextId = createBlockIdAllocator(content)
  let changed = false

  const ensureId = (current: string | null | undefined): string => {
    if (current && !seen.has(current)) {
      seen.add(current)
      return current
    }
    changed = true
    const fresh = nextId()
    seen.add(fresh)
    return fresh
  }

  const stampBlock = (block: BlockJSON): BlockJSON => {
    // Defensive: a malformed node may lack `attrs` entirely — never throw,
    // just synthesize the attrs object around a fresh id.
    const attrs = block.attrs ?? ({} as BlockJSON['attrs'])
    const id = ensureId(attrs.id)
    if (block.attrs && id === attrs.id) return block
    return { ...block, attrs: { ...attrs, id } }
  }

  const stampPanel = (panel: PanelJSON): PanelJSON => {
    const attrs = panel.attrs ?? ({} as PanelJSON['attrs'])
    const id = ensureId(attrs.id)
    const stampedContent = (panel.content ?? []).map(stampBlock)
    const contentChanged = stampedContent.some((b, i) => b !== (panel.content ?? [])[i])
    if (panel.attrs && id === attrs.id && !contentChanged) return panel
    return { ...panel, attrs: { ...attrs, id }, content: stampedContent }
  }

  const stampContainer = (node: ContainerBlockJSON): ContainerBlockJSON => {
    const id = ensureId(node.attrs?.id)
    const idChanged = id !== node.attrs?.id
    if (node.type === 'tabs' || node.type === 'accordion') {
      const stampedPanels = node.content.map(stampPanel)
      const panelsChanged = stampedPanels.some((p, i) => p !== node.content[i])
      if (!idChanged && !panelsChanged) return node
      return {
        ...node,
        attrs: { ...node.attrs, id },
        content: stampedPanels,
      } as ContainerBlockJSON
    }
    // table
    const stampedRows = node.content.map((row) => ({
      ...row,
      content: row.content.map((cell) => ({
        ...cell,
        content: cell.content.map(stampBlock),
      })),
    }))
    return { ...node, attrs: { ...node.attrs, id }, content: stampedRows }
  }

  const out = content.map((node): ArticleNodeJSON => {
    if (node.type === 'block') return stampBlock(node)
    return stampContainer(node)
  })

  return { content: out, changed }
}

// packages/lib/src/kb/markdown/stamp-ids.ts

import { generateId } from '@auxx/utils'
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
 */
export function stampBlockIds(content: ArticleNodeJSON[]): {
  content: ArticleNodeJSON[]
  changed: boolean
} {
  const seen = new Set<string>()
  let changed = false

  const ensureId = (current: string | null | undefined): string => {
    if (current && !seen.has(current)) {
      seen.add(current)
      return current
    }
    changed = true
    const fresh = generateId()
    seen.add(fresh)
    return fresh
  }

  const stampBlock = (block: BlockJSON): BlockJSON => {
    const id = ensureId(block.attrs.id)
    if (id === block.attrs.id) return block
    return { ...block, attrs: { ...block.attrs, id } }
  }

  const stampPanel = (panel: PanelJSON): PanelJSON => {
    const id = ensureId(panel.attrs.id)
    const stampedContent = panel.content.map(stampBlock)
    const contentChanged = stampedContent.some((b, i) => b !== panel.content[i])
    if (id === panel.attrs.id && !contentChanged) return panel
    return { ...panel, attrs: { ...panel.attrs, id }, content: stampedContent }
  }

  const stampContainer = (node: ContainerBlockJSON): ContainerBlockJSON => {
    if (node.type === 'tabs' || node.type === 'accordion') {
      const stampedPanels = node.content.map(stampPanel)
      const panelsChanged = stampedPanels.some((p, i) => p !== node.content[i])
      if (!panelsChanged) return node
      return { ...node, content: stampedPanels } as ContainerBlockJSON
    }
    // table
    const stampedRows = node.content.map((row) => ({
      ...row,
      content: row.content.map((cell) => ({
        ...cell,
        content: cell.content.map(stampBlock),
      })),
    }))
    return { ...node, content: stampedRows }
  }

  const out = content.map((node): ArticleNodeJSON => {
    if (node.type === 'block') return stampBlock(node)
    return stampContainer(node)
  })

  return { content: out, changed }
}

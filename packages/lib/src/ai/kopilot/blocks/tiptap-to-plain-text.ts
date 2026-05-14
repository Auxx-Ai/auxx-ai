// packages/lib/src/ai/kopilot/blocks/tiptap-to-plain-text.ts

/**
 * Naive walker that flattens a Tiptap JSON document into plain text. Text
 * nodes are concatenated with single spaces inside a block; block-level
 * nodes (paragraph, heading, list-item, code-block, etc.) are joined with
 * newlines.
 *
 * Phase 1: chip rendering for `agent` / `record` / `tool` mention nodes is
 * out of scope — they collapse to their `label` attr (or empty string) for
 * now. See `plans/kopilot/agents/prompt-mentions.md` for the eventual
 * full-fidelity renderer.
 *
 * Tolerant of malformed input: anything that's not the expected shape
 * yields an empty string rather than throwing.
 */
export function tiptapDocToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  return walkNode(doc as TiptapNode).trim()
}

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

const BLOCK_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
])

function walkNode(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'mention' || node.type === 'mentionRecord' || node.type === 'mentionAgent') {
    const label = (node.attrs?.label as string | undefined) ?? ''
    return label
  }
  if (Array.isArray(node.content)) {
    const isBlock = !node.type || BLOCK_TYPES.has(node.type)
    const parts = node.content.map(walkNode).filter((s) => s.length > 0)
    return isBlock ? parts.join('\n') : parts.join(' ')
  }
  return ''
}

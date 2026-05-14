// packages/lib/src/ai/kopilot/blocks/tiptap-to-plain-text.ts

interface TiptapToPlainTextOptions {
  /**
   * Optional resolver for inline `reference` nodes. Receives the `RecordId`
   * and returns the markdown text to inline (typically `[Title](recordId)`).
   * When unset, references render as `[reference](id)` — the same form used
   * by `blocksToMd`, so a re-paste round-trips.
   */
  references?: (id: string) => string
}

/**
 * Naive walker that flattens a Tiptap JSON document into plain text. Text
 * nodes are concatenated with single spaces inside a block; block-level
 * nodes (paragraph, heading, list-item, code-block, etc.) are joined with
 * newlines.
 *
 * Inline `reference` nodes flow through the optional `references` resolver
 * — see `references/preresolve.ts` for the title-fetching pipeline.
 *
 * Phase 1: chip rendering for `agent` / `record` / `tool` mention nodes is
 * out of scope — they collapse to their `label` attr (or empty string) for
 * now. See `plans/kopilot/agents/prompt-mentions.md` for the eventual
 * full-fidelity renderer.
 *
 * Tolerant of malformed input: anything that's not the expected shape
 * yields an empty string rather than throwing.
 */
export function tiptapDocToPlainText(doc: unknown, options: TiptapToPlainTextOptions = {}): string {
  if (!doc || typeof doc !== 'object') return ''
  return walkNode(doc as TiptapNode, options).trim()
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
  // KB block schema — `Doc -> block -> inline`. Each `block` is a block-
  // level container that should join its siblings with newlines.
  'block',
])

function walkNode(node: TiptapNode, options: TiptapToPlainTextOptions): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'mention' || node.type === 'mentionRecord' || node.type === 'mentionAgent') {
    const label = (node.attrs?.label as string | undefined) ?? ''
    return label
  }
  if (node.type === 'reference') {
    const id = typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : ''
    if (!id) return ''
    return options.references ? options.references(id) : `[reference](${id})`
  }
  if (Array.isArray(node.content)) {
    const isBlock = !node.type || BLOCK_TYPES.has(node.type)
    const parts = node.content.map((child) => walkNode(child, options)).filter((s) => s.length > 0)
    return isBlock ? parts.join('\n') : parts.join(' ')
  }
  return ''
}

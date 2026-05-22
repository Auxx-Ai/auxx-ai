// packages/lib/src/tiptap/doc-to-text.ts

import type { TiptapNode } from './types'

interface DocToTextOptions {
  /**
   * Optional resolver for inline `reference` nodes. Receives the `RecordId`
   * and returns the markdown text to inline (typically `[Title](recordId)`).
   * When unset, references render as `[reference](id)` — the same form used
   * by `blocksToMd`, so a re-paste round-trips.
   */
  references?: (id: string) => string
  /**
   * Optional resolver for inline `variable-node` chips. Receives the
   * `variableId` and returns the text to inline (typically the resolved
   * variable value, formatted for display). When unset, the chip renders
   * to `{{variableId}}` so a downstream regex-based interpolation pass
   * can pick it up — matches legacy behavior used by the 9 non-AI
   * workflow nodes.
   */
  variables?: (variableId: string) => string
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
export function docToText(doc: unknown, options: DocToTextOptions = {}): string {
  if (!doc || typeof doc !== 'object') return ''
  return walkNode(doc as TiptapNode, options).trim()
}

// Block containers whose children are block-level siblings — join with '\n'.
const BLOCK_CONTAINER_TYPES = new Set([
  'doc',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  // KB block schema — `Doc -> block -> inline`. Each `block` is a block-
  // level container that should join its siblings with newlines.
  'block',
])

// Inline containers whose children are inline (text + chips) — join with ''.
const INLINE_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'horizontalRule'])

function walkNode(node: TiptapNode, options: DocToTextOptions): string {
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
  if (node.type === 'variable-node') {
    const variableId =
      typeof node.attrs?.variableId === 'string' ? (node.attrs.variableId as string) : ''
    if (!variableId) return ''
    return options.variables ? options.variables(variableId) : `{{${variableId}}}`
  }
  if (Array.isArray(node.content)) {
    const parts = node.content.map((child) => walkNode(child, options)).filter((s) => s.length > 0)
    if (!node.type || BLOCK_CONTAINER_TYPES.has(node.type)) return parts.join('\n')
    if (INLINE_CONTAINER_TYPES.has(node.type)) return parts.join('')
    return parts.join(' ')
  }
  return ''
}

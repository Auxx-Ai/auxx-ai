// packages/ui/src/components/kb/utils/inline-text.ts

import type { BlockJSON, DocJSON, InlineJSON } from '../article/types'

/** Walk inline content (text + marks + placeholders) into a plain string. */
export function walkInlineToText(nodes: InlineJSON[] | undefined): string {
  if (!nodes || nodes.length === 0) return ''
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.text ?? ''
    } else if (node.type === 'placeholder') {
      const label = (node.attrs?.label as string | undefined) ?? ''
      out += label ? `{${label}}` : ''
    }
  }
  return out
}

/** Plain-text dump of every block in the doc. Used for search snippets. */
export function extractPlainText(doc: DocJSON | null | undefined): string {
  if (!doc || !doc.content) return ''
  const parts: string[] = []
  for (const block of doc.content) {
    const text = walkInlineToText(block.content)
    if (text) parts.push(text)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Pull every heading's text out for search facet weighting. */
export function extractHeadings(doc: DocJSON | null | undefined): string[] {
  if (!doc || !doc.content) return []
  const out: string[] = []
  for (const block of doc.content) {
    if (isHeadingBlock(block)) {
      const text = walkInlineToText(block.content)
      if (text) out.push(text)
    }
  }
  return out
}

function isHeadingBlock(block: BlockJSON): boolean {
  return block.attrs?.blockType === 'heading'
}

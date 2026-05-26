// packages/lib/src/kb/markdown/plain-text.ts
//
// Plain-text extraction over the KB article block schema. Mirrors the
// extractor in `@auxx/ui/components/kb/utils/inline-text.ts` but lives here
// so server consumers (e.g. the chat widget KB search endpoint) can use it
// without pulling in `@auxx/ui`.

import type { ArticleNodeJSON, BlockJSON, InlineJSON } from './types'

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

/**
 * Plain-text dump of every block in the article body, including container
 * panels (tabs/accordion) and table cells. Whitespace is collapsed.
 */
export function extractPlainText(content: ArticleNodeJSON[] | null | undefined): string {
  if (!content) return ''
  const parts: string[] = []
  for (const node of content) {
    if (node.type === 'block') {
      const text = walkInlineToText(node.content)
      if (text) parts.push(text)
    } else if (node.type === 'tabs' || node.type === 'accordion') {
      for (const panel of node.content) {
        if (panel.attrs.label) parts.push(panel.attrs.label)
        for (const block of panel.content) {
          const text = walkInlineToText(block.content)
          if (text) parts.push(text)
        }
      }
    } else if (node.type === 'table') {
      for (const row of node.content) {
        for (const cell of row.content) {
          for (const block of cell.content) {
            const text = walkInlineToText(block.content)
            if (text) parts.push(text)
          }
        }
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Pull every heading's text out for search facet weighting. Container
 * blocks don't contribute headings — their panel labels are already covered
 * by `extractPlainText`.
 */
export function extractHeadings(content: ArticleNodeJSON[] | null | undefined): string[] {
  if (!content) return []
  const out: string[] = []
  for (const node of content) {
    if (node.type !== 'block') continue
    if (isHeadingBlock(node)) {
      const text = walkInlineToText(node.content)
      if (text) out.push(text)
    }
  }
  return out
}

function isHeadingBlock(block: BlockJSON): boolean {
  return block.attrs?.blockType === 'heading'
}

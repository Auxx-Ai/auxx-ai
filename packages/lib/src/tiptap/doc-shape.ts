// packages/lib/src/tiptap/doc-shape.ts

import type { TiptapNode } from './types'

/**
 * True when the Tiptap doc has at least one non-empty text node, inline
 * `reference`, or `mention` node. Empty paragraphs (which Tiptap emits when
 * the user just hits Enter) don't count.
 *
 * Used for input validation on comment/instruction routers — the empty
 * doc Tiptap produces on first mount must not be persisted as content.
 */
export function isNonEmptyDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  return walk(doc as TiptapNode)
}

function walk(node: TiptapNode): boolean {
  if (typeof node.text === 'string' && node.text.trim().length > 0) return true
  if (node.type === 'reference' || node.type === 'mention') return true
  if (Array.isArray(node.content)) {
    for (const child of node.content) if (walk(child)) return true
  }
  return false
}

/**
 * Pop trailing empty top-level paragraphs off a Tiptap doc. Tiptap emits an
 * extra empty paragraph whenever the user hits Enter at the end; we don't
 * want that persisted. Keeps at least one paragraph so the doc stays valid.
 */
export function trimTrailingEmptyParagraphs<T extends TiptapNode>(doc: T): T {
  if (!Array.isArray(doc.content)) return doc
  const content = [...doc.content]
  while (
    content.length > 1 &&
    content.at(-1)?.type === 'paragraph' &&
    isEmptyParagraph(content.at(-1))
  ) {
    content.pop()
  }
  return { ...doc, content }
}

function isEmptyParagraph(node: TiptapNode | undefined): boolean {
  if (!node) return true
  if (!Array.isArray(node.content) || node.content.length === 0) return true
  return node.content.every(
    (c) => c?.type === 'hardBreak' || (c?.type === 'text' && !c.text?.trim())
  )
}

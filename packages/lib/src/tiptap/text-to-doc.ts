// packages/lib/src/tiptap/text-to-doc.ts

import type { TiptapDoc, TiptapNode } from './types'

export interface TextToDocOptions {
  /**
   * When set, `@[<recordId>]` substrings are converted to inline
   * `reference` nodes (`{ type: 'reference', attrs: { id } }`). When
   * unset, those substrings stay as literal text.
   *
   * The marker form matches the Tiptap inline node's own `serialize`
   * output in `apps/web/.../reference-picker-extensions.ts:41`, so docs
   * round-trip cleanly between the editor and LLM-authored content.
   */
  parseReferences?: boolean
}

const REFERENCE_MARKER = /@\[([^\]]+)\]/g

/**
 * Build a minimal Tiptap doc from plain text. `\n\n` splits paragraphs;
 * a lone `\n` becomes a hard break inside the current paragraph. With
 * `parseReferences: true`, `@[<recordId>]` substrings become inline
 * `reference` nodes.
 *
 * Yields an empty paragraph doc for empty input — never throws.
 */
export function textToDoc(text: string, options: TextToDocOptions = {}): TiptapDoc {
  if (!text || !text.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  const paragraphs = text.split(/\n\n+/)
  const content: TiptapNode[] = paragraphs.map((paragraph) => ({
    type: 'paragraph',
    content: buildInline(paragraph, options),
  }))

  return { type: 'doc', content }
}

function buildInline(paragraph: string, options: TextToDocOptions): TiptapNode[] {
  const lines = paragraph.split('\n')
  const out: TiptapNode[] = []
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ type: 'hardBreak' })
    if (options.parseReferences) {
      for (const node of splitReferences(line)) out.push(node)
    } else if (line.length > 0) {
      out.push({ type: 'text', text: line })
    }
  })
  return out
}

function splitReferences(line: string): TiptapNode[] {
  const out: TiptapNode[] = []
  let lastIndex = 0
  REFERENCE_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = REFERENCE_MARKER.exec(line)) !== null) {
    const id = match[1]
    if (!id) continue
    if (match.index > lastIndex) {
      out.push({ type: 'text', text: line.slice(lastIndex, match.index) })
    }
    out.push({ type: 'reference', attrs: { id } })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < line.length) {
    out.push({ type: 'text', text: line.slice(lastIndex) })
  }
  return out
}

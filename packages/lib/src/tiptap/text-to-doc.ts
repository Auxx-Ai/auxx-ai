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
  /**
   * When set, `{{<variableId>}}` substrings are converted to inline
   * `variable-node` nodes (`{ type: 'variable-node', attrs: { variableId } }`).
   * Mirrors `parseReferences` for the workflow variable picker chip.
   *
   * The chip shape matches the apps/web `variable-node` extension —
   * see `apps/web/src/components/workflow/ui/input-editor/tiptap-converters.ts`.
   */
  parseVariables?: boolean
}

const REFERENCE_MARKER = /@\[([^\]]+)\]/g
const VARIABLE_MARKER = /\{\{([^}]+)\}\}/g

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
    if (options.parseReferences || options.parseVariables) {
      for (const node of splitMarkers(line, options)) out.push(node)
    } else if (line.length > 0) {
      out.push({ type: 'text', text: line })
    }
  })
  return out
}

interface Marker {
  index: number
  length: number
  node: TiptapNode
}

function splitMarkers(line: string, options: TextToDocOptions): TiptapNode[] {
  const markers: Marker[] = []
  if (options.parseReferences) {
    REFERENCE_MARKER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = REFERENCE_MARKER.exec(line)) !== null) {
      const id = match[1]
      if (!id) continue
      markers.push({
        index: match.index,
        length: match[0].length,
        node: { type: 'reference', attrs: { id } },
      })
    }
  }
  if (options.parseVariables) {
    VARIABLE_MARKER.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = VARIABLE_MARKER.exec(line)) !== null) {
      const variableId = match[1]
      if (!variableId) continue
      markers.push({
        index: match.index,
        length: match[0].length,
        node: { type: 'variable-node', attrs: { variableId } },
      })
    }
  }
  markers.sort((a, b) => a.index - b.index)

  const out: TiptapNode[] = []
  let lastIndex = 0
  for (const marker of markers) {
    // Skip overlapping markers (later marker subsumed by earlier).
    if (marker.index < lastIndex) continue
    if (marker.index > lastIndex) {
      out.push({ type: 'text', text: line.slice(lastIndex, marker.index) })
    }
    out.push(marker.node)
    lastIndex = marker.index + marker.length
  }
  if (lastIndex < line.length) {
    out.push({ type: 'text', text: line.slice(lastIndex) })
  }
  return out
}

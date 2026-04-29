// packages/ui/src/components/kb/article/extract-headings.ts

import { walkInlineToText } from '../utils/inline-text'
import type { DocJSON } from './types'

export interface KBHeading {
  id: string
  text: string
  /** 2 = h2 (level 1 in editor), 3 = h3 (level 2 in editor). */
  depth: 2 | 3
}

/**
 * Walk the doc JSON and extract h2/h3 headings with stable, collision-free anchor ids.
 * Editor stores level=1 → renders as h2, level=2 → renders as h3, level=3 → h4 (skipped).
 */
export function extractKBHeadings(doc: DocJSON | null | undefined): KBHeading[] {
  if (!doc?.content) return []
  const out: KBHeading[] = []
  const seen = new Map<string, number>()
  doc.content.forEach((node, idx) => {
    if (node.attrs?.blockType !== 'heading') return
    const level = node.attrs?.level ?? 1
    if (level !== 1 && level !== 2) return
    const text = walkInlineToText(node.content).trim()
    if (!text) return
    const baseId = slugify(text) || `h-${idx}`
    const count = seen.get(baseId) ?? 0
    seen.set(baseId, count + 1)
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`
    out.push({ id, text, depth: level === 1 ? 2 : 3 })
  })
  return out
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 64)
}

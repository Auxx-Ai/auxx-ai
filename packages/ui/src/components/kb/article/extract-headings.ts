// packages/ui/src/components/kb/article/extract-headings.ts

import { walkInlineToText } from '../utils/inline-text'
import type { DocJSON } from './types'

export interface KBHeading {
  id: string
  text: string
  /** Rendered HTML depth: 2 = h2 (editor level 1), 3 = h3 (editor level 2), 4 = h4 (editor level 3). */
  depth: 2 | 3 | 4
}

/**
 * Walk the doc JSON and extract h2/h3/h4 headings with stable, collision-free anchor ids.
 * Editor stores level=1 → renders as h2, level=2 → renders as h3, level=3 → renders as h4.
 */
export function extractKBHeadings(doc: DocJSON | null | undefined): KBHeading[] {
  if (!doc?.content) return []
  const out: KBHeading[] = []
  const seen = new Map<string, number>()
  doc.content.forEach((node, idx) => {
    if (node.type !== 'block') return
    if (node.attrs?.blockType !== 'heading') return
    const level = node.attrs?.level ?? 1
    if (level !== 1 && level !== 2 && level !== 3) return
    const text = walkInlineToText(node.content).trim()
    if (!text) return
    const baseId = slugify(text) || `h-${idx}`
    const count = seen.get(baseId) ?? 0
    seen.set(baseId, count + 1)
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`
    const depth: 2 | 3 | 4 = level === 1 ? 2 : level === 2 ? 3 : 4
    out.push({ id, text, depth })
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

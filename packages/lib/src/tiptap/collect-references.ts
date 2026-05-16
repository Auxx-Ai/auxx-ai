// packages/lib/src/tiptap/collect-references.ts

import type { RecordId } from '../resources/resource-id'
import type { TiptapNode } from './types'

/**
 * Walk a Tiptap doc and collect every inline `reference` node's `RecordId`,
 * de-duplicated and in document order. Tolerant of malformed input —
 * unrecognized shapes yield an empty array.
 */
export function collectReferenceIds(doc: unknown): RecordId[] {
  if (!doc || typeof doc !== 'object') return []
  const seen = new Set<string>()
  const out: RecordId[] = []
  walk(doc as TiptapNode, (id) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id as RecordId)
  })
  return out
}

function walk(node: TiptapNode, visit: (id: string) => void): void {
  if (node.type === 'reference') {
    const id = typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : ''
    if (id) visit(id)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, visit)
  }
}

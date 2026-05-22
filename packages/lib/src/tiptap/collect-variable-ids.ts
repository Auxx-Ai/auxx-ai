// packages/lib/src/tiptap/collect-variable-ids.ts

import type { TiptapNode } from './types'

/**
 * Walk a Tiptap doc and collect every inline `variable-node` chip's
 * `variableId`, de-duplicated and in document order. Tolerant of
 * malformed input — unrecognized shapes yield an empty array.
 *
 * Mirrors `collectReferenceIds`. Used by the AI workflow node to batch-
 * resolve all `{{var}}` references in a prompt template via a single
 * `ExecutionContextManager.buildOptimizedContext` call (see Phase 5).
 */
export function collectVariableIds(doc: unknown): string[] {
  if (!doc || typeof doc !== 'object') return []
  const seen = new Set<string>()
  const out: string[] = []
  walk(doc as TiptapNode, (id) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  })
  return out
}

function walk(node: TiptapNode, visit: (id: string) => void): void {
  if (node.type === 'variable-node') {
    const id = typeof node.attrs?.variableId === 'string' ? (node.attrs.variableId as string) : ''
    if (id) visit(id)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, visit)
  }
}

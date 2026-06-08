// apps/web/src/components/agents/procedures/ui/reference-usage.ts
import type { JSONContent } from '@tiptap/core'

export interface ReferenceUsage {
  /** Total number of inline badges pointing at the target across the whole draft. */
  count: number
  /** Human-readable containers, e.g. ['the main procedure', 'sub-procedure “Refund”']. */
  locations: string[]
}

interface SubProcedureWithContent {
  id: string
  name: string
  content: JSONContent[]
}

/** Count `reference` nodes whose `attrs.id` equals `refId` within a content tree. */
function countInTree(nodes: JSONContent[], refId: string): number {
  let count = 0
  const walk = (node: JSONContent) => {
    if (node.type === 'reference' && node.attrs?.id === refId) count++
    if (Array.isArray(node.content)) for (const child of node.content) walk(child)
  }
  for (const node of nodes) walk(node)
  return count
}

/**
 * Scan the whole procedure draft (main prose + every sub-procedure body) for inline
 * badges referencing `refId` (`code:<id>` or `subprocedure:<id>`). Used to block the
 * deletion of a building block while it's still wired into the procedure — so a delete
 * never leaves a dangling badge behind.
 */
export function countReferences(
  refId: string,
  opts: {
    mainContent: JSONContent[]
    subProcedures: SubProcedureWithContent[]
    /** Skip this sub-procedure's own body (when deleting that sub-procedure itself). */
    excludeSubId?: string
  }
): ReferenceUsage {
  const locations: string[] = []
  let count = 0

  const inMain = countInTree(opts.mainContent, refId)
  if (inMain > 0) {
    count += inMain
    locations.push('the main procedure')
  }

  for (const sub of opts.subProcedures) {
    if (sub.id === opts.excludeSubId) continue
    const n = countInTree(sub.content, refId)
    if (n > 0) {
      count += n
      locations.push(`sub-procedure “${sub.name.trim() || 'Untitled'}”`)
    }
  }

  return { count, locations }
}

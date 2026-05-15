// packages/lib/src/ai/kopilot/capabilities/apps/digest.ts

/**
 * Generic auto-digest for app tool results. Authors don't write their own
 * digest in v1 (decision B5 / J1 in tool-loading-and-execution.md §11).
 *
 * The digest carries the catalog's `refs` shape with runtime values mined out
 * of the tool's output — the snapshot walker consumes this list to fence
 * entity-cards, thread-lists, etc. See plans/kopilot/apps/refs.md §5 + §8.
 */

export interface AppToolDigest {
  kind: 'app-tool'
  appSlug: string
  toolId: string
  summary: string
  refs?: Array<{ kind: string; value: string }>
}

interface RefDescriptor {
  path: string[]
  kind: string
}

/**
 * Build the app-tool digest from a tool's raw output and the catalog's ref
 * descriptors. Walks each descriptor's path against the output to extract the
 * id string the LLM (and the snapshot walker) can use to fence a card.
 */
export function buildAppToolDigest(
  output: unknown,
  meta: { appSlug: string; toolId: string },
  refDescriptors: RefDescriptor[]
): AppToolDigest {
  const refs: Array<{ kind: string; value: string }> = []
  for (const desc of refDescriptors) {
    for (const value of resolvePath(output, desc.path)) {
      if (typeof value === 'string' && value.length > 0) {
        refs.push({ kind: desc.kind, value })
      }
    }
  }
  return {
    kind: 'app-tool',
    appSlug: meta.appSlug,
    toolId: meta.toolId,
    summary: `${meta.appSlug} → ${meta.toolId}`,
    refs: refs.length > 0 ? refs : undefined,
  }
}

/**
 * Walk a dotted path through the output, expanding `[]` into all array
 * elements. Returns every value reached — flat array of leaves.
 */
function resolvePath(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) return [value]
  if (value == null) return []
  const [head, ...rest] = path
  if (head === '[]') {
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => resolvePath(entry, rest))
  }
  if (typeof value === 'object') {
    return resolvePath((value as Record<string, unknown>)[head as string], rest)
  }
  return []
}

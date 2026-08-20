// packages/lib/src/workflow-engine/catalog/graph-vars.ts

import { BaseType } from '../core/types'

/**
 * Lightweight node representation for graph computation. React Flow nodes,
 * engine nodes and agent-authored graphs all satisfy it structurally — same
 * pattern as `TriggerDerivationNode` in `derive-trigger.ts`.
 */
export interface NodeMeta {
  id: string
  type: string
  data: any
  parentId?: string
}

/** Lightweight edge representation for graph computation */
export interface EdgeMeta {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  data?: { isLoopBackEdge?: boolean }
}

/** Loop ancestry entry computed for a node by `computeLoopAncestry`. */
export interface GraphLoopContext {
  loopNodeId: string
  iteratorName: string
  iteratorType?: BaseType
  depth: number
  parentLoopContext?: GraphLoopContext
}

/**
 * Filter out edges that form intentional cycles in loops:
 * - Edges marked as isLoopBackEdge
 * - Edges from a node inside a loop back to its parent loop node
 */
function getForwardEdges(edges: EdgeMeta[], nodes: NodeMeta[]): EdgeMeta[] {
  const loopNodeIds = new Set(nodes.filter((n) => n.type === 'loop').map((n) => n.id))
  return edges.filter((e) => {
    if (e.data?.isLoopBackEdge) return false
    if (loopNodeIds.has(e.target)) {
      const sourceNode = nodes.find((n) => n.id === e.source)
      if (sourceNode?.parentId === e.target || sourceNode?.data?.loopId === e.target) {
        return false
      }
    }
    return true
  })
}

/**
 * The plain output handle every non-branching node exposes, and what an ABSENT
 * `sourceHandle` means.
 *
 * Declared here rather than in `workflows/graph-edit/branches.ts` (which
 * re-exports it) because `graph-edit` imports *from* the catalog and not the
 * reverse, and the alternative — two inline `edge.sourceHandle ?? 'source'`
 * spellings of one rule — is how the two halves drift apart.
 */
export const DEFAULT_SOURCE_HANDLE = 'source'

/**
 * For each node: which ancestors reach it, and on **which of each ancestor's
 * own source handles**. `consumerId → ancestorId → handle ids`.
 *
 * This is the primitive branch-scoped availability needs (plan 24 §5): every
 * consumer of ancestry until now treated "reachable" and "reachable on this
 * branch" as the same question, so a node on a crud node's `fail` branch was
 * offered the whole record the fail path never wrote.
 *
 * ## Why reverse BFS and not a topological forward pass
 *
 * A forward pass in `topologicalSort` order looks tempting and is wrong:
 * `topologicalSort` **appends residual-cycle nodes at the end** with a warning
 * (see below in this file), so a single forward pass over that order computes
 * an INCOMPLETE transitive closure where the BFS below is complete. Graphs
 * carrying a genuine non-loop cycle exist — that warning is there because they
 * do — and {@link buildUpstreamMap} must stay byte-identical.
 *
 * ## The two properties that make it correct
 *
 * - **The handle recorded is the ancestor's OWN.** It is read off the edge
 *   *leaving* the ancestor, never off the edge that got us to it.
 *   `Create Contact --fail--> Log Failure --source--> Notify` gives
 *   `via[Notify][Create Contact] = {fail}`, not `{source}`.
 * - **No handle is lost to the `visited` check.** The union is accumulated when
 *   the EDGE is enumerated, not when the node is first reached, and every
 *   visited node's incoming edges are enumerated exactly once. An edge
 *   `(p --h--> x)` matters iff `x` is on a path to the consumer, i.e.
 *   `x ∈ visited ∪ {consumer}` — precisely the set enumerated. Deduping on the
 *   predecessor *node* instead is the way to lose a second handle, and it is
 *   the single most likely bug in this function.
 *
 * Built over {@link getForwardEdges}: a loop-back edge left in would
 * manufacture a path and widen every scope back to unscoped, which is the
 * easiest way to implement this whole feature and have it do nothing.
 *
 * Cost is the existing walk plus set unions; worst case `O(V² · H)` memory,
 * which for graphs of tens of nodes is nothing — but note that the browser's
 * `updateGraph` rebuilds this on every structural change.
 */
export function buildUpstreamHandleMap(
  edges: EdgeMeta[],
  nodes: NodeMeta[]
): Map<string, Map<string, Set<string>>> {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const via = new Map<string, Map<string, Set<string>>>()
  for (const nodeId of nodeIds) {
    via.set(nodeId, new Map())
  }

  // Filter out loop-back edges to prevent cycles in upstream computation
  const forwardEdges = getForwardEdges(edges, nodes)

  // Incoming-edge index, built once for the whole graph rather than re-scanning
  // `forwardEdges` per node. Insertion order mirrors the edge array, which is
  // what keeps the projection's Set iteration order identical to the old BFS.
  const incoming = new Map<string, Array<{ source: string; handle: string }>>()
  for (const nodeId of nodeIds) {
    incoming.set(nodeId, [])
  }
  for (const edge of forwardEdges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      incoming.get(edge.target)!.push({
        source: edge.source,
        handle: edge.sourceHandle ?? DEFAULT_SOURCE_HANDLE,
      })
    }
  }

  for (const nodeId of nodeIds) {
    const ancestors = via.get(nodeId)!
    const visited = new Set<string>([nodeId])
    const queue: string[] = [nodeId]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const { source, handle } of incoming.get(current) ?? []) {
        // Record on EDGE enumeration — before the visited check, so a second
        // path to the same ancestor still contributes its handle.
        let handles = ancestors.get(source)
        if (!handles) {
          handles = new Set()
          ancestors.set(source, handles)
        }
        handles.add(handle)
        if (!visited.has(source)) {
          visited.add(source)
          queue.push(source)
        }
      }
    }
  }

  return via
}

/**
 * Build upstream map for all nodes in one pass.
 * For each node, computes the full set of upstream node IDs via edge traversal.
 *
 * The key-set projection of {@link buildUpstreamHandleMap}, so there is exactly
 * one ancestry implementation. Its results are byte-identical to the standalone
 * BFS this replaced — including Set iteration order and behaviour inside a
 * residual cycle — and every existing `graph-vars` / `resolve-outputs` /
 * `ref-check` test passing unchanged is the honesty check for that.
 */
export function buildUpstreamMap(edges: EdgeMeta[], nodes: NodeMeta[]): Map<string, Set<string>> {
  const upstreamMap = new Map<string, Set<string>>()
  for (const [consumerId, ancestors] of buildUpstreamHandleMap(edges, nodes)) {
    upstreamMap.set(consumerId, new Set(ancestors.keys()))
  }
  return upstreamMap
}

/**
 * Invert upstream map to get downstream map.
 * For each upstream node, the downstream set contains all nodes that depend on it.
 */
export function buildDownstreamMap(
  upstreamMap: Map<string, Set<string>>
): Map<string, Set<string>> {
  const downstreamMap = new Map<string, Set<string>>()

  // Initialize empty sets for all nodes
  for (const nodeId of upstreamMap.keys()) {
    downstreamMap.set(nodeId, new Set())
  }

  // Invert: if B is upstream of A, then A is downstream of B
  for (const [nodeId, upstreams] of upstreamMap) {
    for (const upstreamId of upstreams) {
      if (!downstreamMap.has(upstreamId)) {
        downstreamMap.set(upstreamId, new Set())
      }
      downstreamMap.get(upstreamId)!.add(nodeId)
    }
  }

  return downstreamMap
}

/**
 * Compute loop ancestry for all nodes.
 * For each node, walks the parentId chain to find loop ancestors.
 */
export function computeLoopAncestry(nodes: NodeMeta[]): Map<string, GraphLoopContext[]> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const ancestry = new Map<string, GraphLoopContext[]>()

  for (const node of nodes) {
    const contexts: GraphLoopContext[] = []
    let current: NodeMeta | undefined = node

    while (current?.parentId) {
      const parent = nodeMap.get(current.parentId)
      if (!parent) break

      const isLoopNode = parent.data?.type === 'loop'
      if (isLoopNode) {
        contexts.push({
          loopNodeId: parent.id,
          iteratorName: 'item',
          iteratorType: BaseType.ANY,
          depth: contexts.length + 1,
        })
      }
      current = parent
    }

    ancestry.set(node.id, contexts.reverse())
  }

  return ancestry
}

/**
 * Topological sort using Kahn's algorithm.
 * Filters out loop-back edges to break intentional cycles.
 * Returns node IDs in topological order (upstream nodes first).
 */
export function topologicalSort(nodes: NodeMeta[], edges: EdgeMeta[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id))

  // Filter out loop-back edges to break intentional cycles
  const forwardEdges = getForwardEdges(edges, nodes)

  // Build in-degree map from forward edges only
  const inDegree = new Map<string, number>()
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0)
  }
  for (const edge of forwardEdges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }
  }

  // Build adjacency list for forward edges
  const adjacency = new Map<string, string[]>()
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, [])
  }
  for (const edge of forwardEdges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target)
    }
  }

  // Kahn's algorithm: start with nodes that have in-degree 0
  const queue: string[] = []
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId)
    }
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) {
        queue.push(neighbor)
      }
    }
  }

  // If there are remaining nodes (unexpected cycles after filtering), append them
  if (sorted.length < nodeIds.size) {
    const sortedSet = new Set(sorted)
    const remaining = [...nodeIds].filter((id) => !sortedSet.has(id))
    if (remaining.length > 0) {
      console.warn(
        `[var-graph] Unexpected cycles detected after filtering loop-back edges. ${remaining.length} nodes appended at end:`,
        remaining
      )
      sorted.push(...remaining)
    }
  }

  return sorted
}

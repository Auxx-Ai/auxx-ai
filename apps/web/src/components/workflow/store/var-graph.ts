// apps/web/src/components/workflow/store/var-graph.ts

import { BaseType } from '../types/unified-types'
import type { LoopContext } from './use-var-store'

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

/** Lightweight node representation for graph computation */
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

/**
 * Build upstream map for all nodes in one pass.
 * For each node, computes the full set of upstream node IDs via edge traversal.
 */
export function buildUpstreamMap(edges: EdgeMeta[], nodes: NodeMeta[]): Map<string, Set<string>> {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const upstreamMap = new Map<string, Set<string>>()

  // Initialize empty sets for all nodes
  for (const nodeId of nodeIds) {
    upstreamMap.set(nodeId, new Set())
  }

  // Filter out loop-back edges to prevent cycles in upstream computation
  const forwardEdges = getForwardEdges(edges, nodes)

  // Build direct predecessors from forward edges only
  const directPredecessors = new Map<string, Set<string>>()
  for (const nodeId of nodeIds) {
    directPredecessors.set(nodeId, new Set())
  }
  for (const edge of forwardEdges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      directPredecessors.get(edge.target)!.add(edge.source)
    }
  }

  // Compute transitive upstream for each node via BFS
  for (const nodeId of nodeIds) {
    const visited = new Set<string>()
    const queue = [...(directPredecessors.get(nodeId) || [])]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      upstreamMap.get(nodeId)!.add(current)
      for (const pred of directPredecessors.get(current) || []) {
        if (!visited.has(pred)) {
          queue.push(pred)
        }
      }
    }
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
export function computeLoopAncestry(nodes: NodeMeta[]): Map<string, LoopContext[]> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const ancestry = new Map<string, LoopContext[]>()

  for (const node of nodes) {
    const contexts: LoopContext[] = []
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

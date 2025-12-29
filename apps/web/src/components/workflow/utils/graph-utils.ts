// apps/web/src/components/workflow/utils/graph-utils.ts

import type { Edge, Node } from '@xyflow/react'
import { NodeType } from '../types/node-types'

/**
 * Get all upstream node IDs for a given node
 * @param nodeId - The target node ID
 * @param edges - All edges in the workflow
 * @param nodes - All nodes in the workflow (optional, needed for loop-aware traversal)
 * @param visitedLoops - Set of visited loop IDs to prevent infinite recursion
 * @returns Set of upstream node IDs for O(1) lookup
 */
export function getUpstreamNodeIds(
  nodeId: string,
  edges: Edge[],
  nodes?: Node[],
  visitedLoops = new Set<string>()
): Set<string> {
  const upstreamIds = new Set<string>()
  const visited = new Set<string>()

  function traverse(currentId: string) {
    if (visited.has(currentId)) return
    visited.add(currentId)

    // Find all edges where current node is the target
    const incomingEdges = edges.filter((edge) => edge.target === currentId)

    for (const edge of incomingEdges) {
      upstreamIds.add(edge.source)

      // If nodes are provided, check for loop handling
      if (nodes) {
        const sourceNode = nodes.find((n) => n.id === edge.source)
        if (sourceNode?.type === NodeType.LOOP && !visitedLoops.has(edge.source)) {
          visitedLoops.add(edge.source)
          // Include all nodes inside the loop as upstream
          const loopChildren = getLoopChildren(edge.source, nodes)
          loopChildren.forEach((child) => upstreamIds.add(child.id))
        }
      }

      traverse(edge.source)
    }
  }

  traverse(nodeId)
  return upstreamIds
}

/**
 * Get all downstream node IDs for a given node
 * @param nodeId - The source node ID
 * @param edges - All edges in the workflow
 * @returns Set of downstream node IDs
 */
export function getDownstreamNodeIds(nodeId: string, edges: Edge[]): Set<string> {
  const downstreamIds = new Set<string>()
  const visited = new Set<string>()

  function traverse(currentId: string) {
    if (visited.has(currentId)) return
    visited.add(currentId)

    // Find all edges where current node is the source
    const outgoingEdges = edges.filter((edge) => edge.source === currentId)

    for (const edge of outgoingEdges) {
      downstreamIds.add(edge.target)
      traverse(edge.target)
    }
  }

  traverse(nodeId)
  return downstreamIds
}

/**
 * Check if a node is reachable from another node
 * @param fromNodeId - The starting node
 * @param toNodeId - The target node
 * @param edges - All edges in the workflow
 * @returns true if there's a path from fromNodeId to toNodeId
 */
export function isNodeReachable(fromNodeId: string, toNodeId: string, edges: Edge[]): boolean {
  const downstreamNodes = getDownstreamNodeIds(fromNodeId, edges)
  return downstreamNodes.has(toNodeId)
}

/**
 * Check if adding an edge would create a cycle
 * @param source - Source node ID
 * @param target - Target node ID
 * @param edges - Current edges in the workflow
 * @returns true if adding the edge would create a cycle
 */
export function wouldCreateCycle(source: string, target: string, edges: Edge[]): boolean {
  // If target can reach source, adding source->target would create a cycle
  return isNodeReachable(target, source, edges)
}

/**
 * Get all child nodes of a loop
 * @param loopId - The loop node ID
 * @param nodes - All nodes in the workflow
 * @returns Array of child nodes
 */
export function getLoopChildren(loopId: string, nodes: Node[]): Node[] {
  return nodes.filter((node) => node.parentId === loopId)
}

/**
 * Get nodes that exit from a loop
 * @param loopId - The loop node ID
 * @param nodes - All nodes in the workflow
 * @param edges - All edges in the workflow
 * @returns Array of nodes that have edges leading outside the loop
 */
export function getLoopExitNodes(loopId: string, nodes: Node[], edges: Edge[]): Node[] {
  const loopChildren = getLoopChildren(loopId, nodes)
  return loopChildren.filter((child) => {
    // Find nodes with outgoing edges to nodes outside the loop
    const outgoingEdges = edges.filter((e) => e.source === child.id)
    return outgoingEdges.some((edge) => {
      const target = nodes.find((n) => n.id === edge.target)
      return target && target.parentId !== loopId
    })
  })
}

/**
 * Check if a node is inside a specific loop
 * @param nodeId - The node to check
 * @param loopId - The loop node ID
 * @param nodes - All nodes in the workflow
 * @returns true if the node is inside the loop
 */
export function isNodeInLoop(nodeId: string, loopId: string, nodes: Node[]): boolean {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return false

  // Check direct parent
  if (node.parentId === loopId) return true

  // Check ancestor chain
  let current = node
  while (current.parentId) {
    if (current.parentId === loopId) return true
    current = nodes.find((n) => n.id === current.parentId)!
    if (!current) break
  }

  return false
}

/**
 * Get the containing loop ID for a node
 * @param nodeId - The node to check
 * @param nodes - All nodes in the workflow
 * @returns The loop ID if the node is inside a loop, null otherwise
 */
export function getContainingLoopId(nodeId: string, nodes: Node[]): string | null {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null

  // If this node itself is a loop
  if (node.type === NodeType.LOOP) return node.id

  // Check parent chain for loops
  let current = node
  while (current.parentId) {
    const parent = nodes.find((n) => n.id === current.parentId)
    if (!parent) break
    if (parent.type === NodeType.LOOP) return parent.id
    current = parent
  }

  return null
}

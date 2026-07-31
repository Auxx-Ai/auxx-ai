// apps/web/src/components/workflow/utils/edge-utils.ts

import type { Edge, Node } from '@xyflow/react'
import type { FlowEdge, FlowNode } from '../types'

type ConnectedSourceOrTargetNodesChange = { type: string; edge: Edge }[]

/** The connection metadata this helper reads off, and writes back onto, node data. */
export interface ConnectedHandleIds {
  _connectedSourceHandleIds: string[]
  _connectedTargetHandleIds: string[]
}

/**
 * Read one of the tracked handle-id arrays off a node's data.
 * React Flow types `Node['data']` as `Record<string, unknown>`, so the value has
 * to be narrowed rather than assumed to be a string array.
 */
const readHandleIds = (data: Record<string, unknown>, key: keyof ConnectedHandleIds): string[] => {
  const value = data[key]
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export const getNodesConnectedSourceOrTargetHandleIdsMap = (
  changes: ConnectedSourceOrTargetNodesChange,
  nodes: Node[]
): Record<string, ConnectedHandleIds> => {
  const nodesConnectedSourceOrTargetHandleIdsMap: Record<string, ConnectedHandleIds> = {}

  const ensureEntry = (node: Node): ConnectedHandleIds => {
    const existing = nodesConnectedSourceOrTargetHandleIdsMap[node.id]
    if (existing) return existing
    const entry: ConnectedHandleIds = {
      _connectedSourceHandleIds: readHandleIds(node.data, '_connectedSourceHandleIds'),
      _connectedTargetHandleIds: readHandleIds(node.data, '_connectedTargetHandleIds'),
    }
    nodesConnectedSourceOrTargetHandleIdsMap[node.id] = entry
    return entry
  }

  changes.forEach((change) => {
    const { edge, type } = change
    const sourceNode = nodes.find((node) => node.id === edge.source)
    const targetNode = nodes.find((node) => node.id === edge.target)

    if (sourceNode) {
      const entry = ensureEntry(sourceNode)

      if (type === 'remove') {
        const index = entry._connectedSourceHandleIds.indexOf(edge.sourceHandle ?? '')
        if (index !== -1) entry._connectedSourceHandleIds.splice(index, 1)
      }

      if (type === 'add') entry._connectedSourceHandleIds.push(edge.sourceHandle || 'source')
    }

    if (targetNode) {
      const entry = ensureEntry(targetNode)

      if (type === 'remove') {
        const index = entry._connectedTargetHandleIds.indexOf(edge.targetHandle ?? '')
        if (index !== -1) entry._connectedTargetHandleIds.splice(index, 1)
      }

      if (type === 'add') entry._connectedTargetHandleIds.push(edge.targetHandle || 'target')
    }
  })

  return nodesConnectedSourceOrTargetHandleIdsMap
}

/**
 * Calculate proper zIndex for an edge based on its loop context
 * Ensures edges inside loops render above loop background but below nodes
 */
export const calculateEdgeZIndex = (edge: FlowEdge, nodes: FlowNode[]): number => {
  // Base zIndex for regular edges
  let zIndex = 0

  // If edge has loopId, it's inside a loop
  const loopId = edge.data?.loopId
  if (loopId) {
    const loopNode = nodes.find((n) => n.id === loopId)
    if (loopNode) {
      // Get loop's zIndex (default to 0 if not set)
      const loopBaseZIndex = loopNode.zIndex || 0

      // Calculate depth if loop is nested
      let depth = 0
      let currentNode = loopNode
      while (currentNode.parentId) {
        depth++
        currentNode = nodes.find((n) => n.id === currentNode.parentId) as FlowNode
        if (!currentNode) break
      }

      // Edges inside loop: base + depth bonus + 5
      // This ensures edges are above loop (base) but below nodes (base + depth * 10)
      zIndex = loopBaseZIndex + depth * 10 + 5
    }
  }
  return 0
  // return zIndex
}

/**
 * Calculate zIndex for an edge based on parent extent of connected nodes
 * If either source or target node has extent === 'parent', returns the larger zIndex of the two nodes
 */
export const calculateZIndex = (edge: FlowEdge, nodes: FlowNode[]): number => {
  const sourceNode = nodes.find((n) => n.id === edge.source)
  const targetNode = nodes.find((n) => n.id === edge.target)

  // If either node has extent === 'parent', use the larger zIndex
  // if (sourceNode?.extent === 'parent' || targetNode?.extent === 'parent') {
  const sourceZIndex = sourceNode?.zIndex ?? 0
  const targetZIndex = targetNode?.zIndex ?? 0
  return Math.max(sourceZIndex, targetZIndex)
  // }

  // Default zIndex for regular edges
  // return 0
}

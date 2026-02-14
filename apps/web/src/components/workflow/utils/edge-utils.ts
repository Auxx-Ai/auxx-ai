// apps/web/src/components/workflow/utils/edge-utils.ts

import type { Edge, Node } from '@xyflow/react'
import type { FlowEdge, FlowNode } from '../types'

type ConnectedSourceOrTargetNodesChange = { type: string; edge: Edge }[]

export const getNodesConnectedSourceOrTargetHandleIdsMap = (
  changes: ConnectedSourceOrTargetNodesChange,
  nodes: Node[]
) => {
  const nodesConnectedSourceOrTargetHandleIdsMap = {} as Record<string, any>

  changes.forEach((change) => {
    const { edge, type } = change
    const sourceNode = nodes.find((node) => node.id === edge.source)!
    if (sourceNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] =
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id] || {
          _connectedSourceHandleIds: [...(sourceNode?.data._connectedSourceHandleIds || [])],
          _connectedTargetHandleIds: [...(sourceNode?.data._connectedTargetHandleIds || [])],
        }
    }

    const targetNode = nodes.find((node) => node.id === edge.target)!
    if (targetNode) {
      nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] =
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id] || {
          _connectedSourceHandleIds: [...(targetNode?.data._connectedSourceHandleIds || [])],
          _connectedTargetHandleIds: [...(targetNode?.data._connectedTargetHandleIds || [])],
        }
    }

    if (sourceNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[
          sourceNode.id
        ]._connectedSourceHandleIds.findIndex((handleId: string) => handleId === edge.sourceHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.splice(
          index,
          1
        )
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[sourceNode.id]._connectedSourceHandleIds.push(
          edge.sourceHandle || 'source'
        )
    }

    if (targetNode) {
      if (type === 'remove') {
        const index = nodesConnectedSourceOrTargetHandleIdsMap[
          targetNode.id
        ]._connectedTargetHandleIds.findIndex((handleId: string) => handleId === edge.targetHandle)
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.splice(
          index,
          1
        )
      }

      if (type === 'add')
        nodesConnectedSourceOrTargetHandleIdsMap[targetNode.id]._connectedTargetHandleIds.push(
          edge.targetHandle || 'target'
        )
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
  if (edge.data?.loopId) {
    const loopNode = nodes.find((n) => n.id === edge.data.loopId)
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

// apps/web/src/components/workflow/utils/node-layout/edge-manager.ts

import { produce } from 'immer'
import type { EdgeData, FlowEdge, FlowNode } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types'
import { LOOP_HANDLES } from '../../nodes/core/loop/constants'
import { unifiedNodeRegistry } from '../../nodes/unified-registry'
import { calculateEdgeZIndex, getNodesConnectedSourceOrTargetHandleIdsMap } from '../edge-utils'

export interface EdgeCreationParams {
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
  sourceType: string
  targetType: string
  isInLoop?: boolean
  loopId?: string
}

export interface EdgeChange {
  type: 'add' | 'remove'
  edge: FlowEdge
}

/**
 * Manages edge creation, deletion, and metadata updates
 */
export class EdgeManager {
  /**
   * Determine the correct handle for a node based on its type and connection context
   */
  private static getNodeHandle(
    nodeType: string,
    handleType: 'source' | 'target',
    position?: string
  ): string {
    // Check if it's a loop node
    if (nodeType === NodeType.LOOP) {
      if (handleType === 'source' && position === 'inside') {
        // When connecting to first node inside a loop
        return LOOP_HANDLES.LOOP_START
      }
      // For all other cases, use standard handles
      // Loop uses standard 'target' for input and 'source' for output
    }

    // For if-else nodes, use specific handles for source
    if (nodeType === NodeType.IF_ELSE && handleType === 'source') {
      return 'true' // Default to true branch, could be made configurable
    }

    // For input category nodes, use input-output handle for source connections
    if (unifiedNodeRegistry.isInputNode(nodeType) && handleType === 'source') {
      return 'input-output'
    }

    // For nodes that accept input data, preserve the default behavior
    // The specific handle should be provided via anchorNode.sourceHandle/targetHandle
    // This fallback only applies when those are not specified

    // Default handles for other node types
    return handleType === 'source' ? 'source' : 'target'
  }
  /**
   * Create an edge with all required metadata
   */
  static createEdge(params: EdgeCreationParams, nodes?: FlowNode[]): FlowEdge {
    const {
      source,
      sourceHandle = 'source',
      target,
      targetHandle = 'target',
      sourceType,
      targetType,
      isInLoop,
      loopId,
    } = params

    const edge: FlowEdge = {
      id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
      source,
      sourceHandle,
      target,
      targetHandle,
      data: { sourceType, targetType, isInLoop, loopId } as EdgeData,
    } as FlowEdge

    // Calculate zIndex if nodes are provided
    if (nodes) {
      // edge.zIndex = calculateEdgeZIndex(edge, nodes)
    }

    return edge
  }

  /**
   * Update nodes with connection metadata based on edge changes
   */
  static updateNodesWithConnectionMetadata(
    nodes: FlowNode[],
    _edges: FlowEdge[],
    changes: EdgeChange[]
  ): FlowNode[] {
    const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(changes, nodes)

    return produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (nodesConnectedMap[node.id]) {
          node.data = { ...node.data, ...nodesConnectedMap[node.id] }
        }
      })
    })
  }

  /**
   * Create edges for different node addition positions
   */
  static createEdgesForPosition(
    position: string,
    newNodeId: string,
    newNodeType: string,
    anchorNode?: { id: string; type?: string; sourceHandle?: string; targetHandle?: string },
    targetNode?: { id: string; type?: string; targetHandle?: string },
    loopContext?: { isInLoop: boolean; loopId?: string },
    nodes?: FlowNode[]
  ): FlowEdge[] {
    const edges: FlowEdge[] = []

    switch (position) {
      case 'after':
        if (anchorNode) {
          // Use provided handle or determine based on node type
          const sourceHandle =
            anchorNode.sourceHandle ||
            EdgeManager.getNodeHandle(anchorNode.type || '', 'source', 'after')

          edges.push(
            EdgeManager.createEdge(
              {
                source: anchorNode.id,
                sourceHandle,
                target: newNodeId,
                targetHandle: EdgeManager.getNodeHandle(newNodeType, 'target'),
                sourceType: anchorNode.type || '',
                targetType: newNodeType,
                isInLoop: loopContext?.isInLoop,
                loopId: loopContext?.loopId,
              },
              nodes
            )
          )
        }
        break

      case 'before':
        if (anchorNode) {
          // Use provided handle or determine based on node type
          const targetHandle =
            anchorNode.targetHandle ||
            EdgeManager.getNodeHandle(anchorNode.type || '', 'target', 'before')

          edges.push(
            EdgeManager.createEdge(
              {
                source: newNodeId,
                sourceHandle: EdgeManager.getNodeHandle(newNodeType, 'source'),
                target: anchorNode.id,
                targetHandle,
                sourceType: newNodeType,
                targetType: anchorNode.type || '',
                isInLoop: loopContext?.isInLoop,
                loopId: loopContext?.loopId,
              },
              nodes
            )
          )
        }
        break

      case 'between':
        if (anchorNode && targetNode) {
          // Create edge from source to new node
          const sourceHandle =
            anchorNode.sourceHandle ||
            EdgeManager.getNodeHandle(anchorNode.type || '', 'source', 'between')

          edges.push(
            EdgeManager.createEdge(
              {
                source: anchorNode.id,
                sourceHandle,
                target: newNodeId,
                targetHandle: EdgeManager.getNodeHandle(newNodeType, 'target'),
                sourceType: anchorNode.type || '',
                targetType: newNodeType,
                isInLoop: loopContext?.isInLoop,
                loopId: loopContext?.loopId,
              },
              nodes
            )
          )

          // Create edge from new node to target
          const newNodeSourceHandle = EdgeManager.getNodeHandle(newNodeType, 'source')
          const targetHandle =
            targetNode.targetHandle ||
            EdgeManager.getNodeHandle(targetNode.type || '', 'target', 'between')

          edges.push(
            EdgeManager.createEdge(
              {
                source: newNodeId,
                sourceHandle: newNodeSourceHandle,
                target: targetNode.id,
                targetHandle,
                sourceType: newNodeType,
                targetType: targetNode.type || '',
                isInLoop: loopContext?.isInLoop,
                loopId: loopContext?.loopId,
              },
              nodes
            )
          )
        }
        break

      case 'parallel':
        if (anchorNode) {
          const sourceHandle =
            anchorNode.sourceHandle ||
            EdgeManager.getNodeHandle(anchorNode.type || '', 'source', 'parallel')

          edges.push(
            EdgeManager.createEdge(
              {
                source: anchorNode.id,
                sourceHandle,
                target: newNodeId,
                targetHandle: EdgeManager.getNodeHandle(newNodeType, 'target'),
                sourceType: anchorNode.type || '',
                targetType: newNodeType,
                isInLoop: loopContext?.isInLoop,
                loopId: loopContext?.loopId,
              },
              nodes
            )
          )
        }
        break
    }

    return edges
  }

  /**
   * Find and remove existing edge between two nodes
   */
  static findExistingEdge(
    edges: FlowEdge[],
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string
  ): FlowEdge | undefined {
    return edges.find(
      (e) =>
        e.source === sourceId &&
        e.target === targetId &&
        e.sourceHandle === (sourceHandle || 'source') &&
        e.targetHandle === (targetHandle || 'target')
    )
  }

  /**
   * Replace node in edges (for node replacement)
   */
  static replaceNodeInEdges(
    edges: FlowEdge[],
    oldNodeId: string,
    newNodeId: string,
    newNodeType: string,
    nodes?: FlowNode[]
  ): FlowEdge[] {
    return edges.map((edge) => {
      if (edge.source === oldNodeId) {
        return EdgeManager.createEdge(
          {
            source: newNodeId,
            sourceHandle: edge.sourceHandle,
            target: edge.target,
            targetHandle: edge.targetHandle,
            sourceType: newNodeType,
            targetType: edge.data?.targetType || '',
            isInLoop: edge.data?.isInLoop,
            loopId: edge.data?.loopId ?? undefined,
          },
          nodes
        )
      }

      if (edge.target === oldNodeId) {
        return EdgeManager.createEdge(
          {
            source: edge.source,
            sourceHandle: edge.sourceHandle,
            target: newNodeId,
            targetHandle: edge.targetHandle,
            sourceType: edge.data?.sourceType || '',
            targetType: newNodeType,
            isInLoop: edge.data?.isInLoop,
            loopId: edge.data?.loopId ?? undefined,
          },
          nodes
        )
      }

      return edge
    })
  }

  /**
   * Validate edge connection
   */
  static validateConnection(
    sourceNode: FlowNode,
    targetNode: FlowNode,
    _sourceHandle: string,
    _targetHandle: string
  ): { valid: boolean; error?: string } {
    // Check for self-connection
    if (sourceNode.id === targetNode.id) {
      return { valid: false, error: 'Cannot connect node to itself' }
    }

    // Add more validation rules as needed
    // - Check node type compatibility
    // - Check handle limits
    // - Check for cycles

    return { valid: true }
  }

  /**
   * Get all edges connected to a node
   */
  static getNodeEdges(
    nodeId: string,
    edges: FlowEdge[]
  ): {
    incoming: FlowEdge[]
    outgoing: FlowEdge[]
  } {
    return {
      incoming: edges.filter((e) => e.target === nodeId),
      outgoing: edges.filter((e) => e.source === nodeId),
    }
  }

  /**
   * Remove edges connected to a node
   */
  static removeNodeEdges(nodeId: string, edges: FlowEdge[]): FlowEdge[] {
    return edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
  }
}

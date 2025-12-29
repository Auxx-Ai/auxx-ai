// apps/web/src/components/workflow/utils/workflow-initializer.ts

import { getConnectedEdges } from '@xyflow/react'
import type { FlowNode, FlowEdge, EdgeData } from '../types'
import { NodeType } from '../types/node-types'
import type { TextClassifierNodeData } from '../nodes/core/text-classifier/types'
import type { LoopNodeData } from '../nodes/core/loop/types'
import type { IfElseNodeData } from '../nodes/core/if-else/types'
import type { HttpNodeData } from '../nodes/core/http/types'
import { ErrorStrategy } from '../nodes/core/http/types'
import type { CrudNodeData } from '../nodes/core/crud/types'
import { branchNameCorrect } from './branch-name-correct'
import { calculateZIndex } from './edge-utils'

/**
 * Calculate target branches based on node type and current data
 */
export const calculateTargetBranches = (
  nodeData: FlowNode['data']
): Array<{ id: string; name: string; type?: string }> | undefined => {
  switch (nodeData.type) {
    case NodeType.IF_ELSE: {
      const ifElseData = nodeData as IfElseNodeData
      // Build branches from cases + ELSE branch
      const branches = [
        ...(ifElseData.cases || []).map((c) => ({ id: c.case_id, name: '' })),
        { id: 'false', name: '' },
      ]
      // Apply proper naming (IF/ELSE for 2 branches, CASE 1/2/ELSE for multiple)
      return branchNameCorrect(branches)
    }

    case NodeType.TEXT_CLASSIFIER: {
      const classifierData = nodeData as TextClassifierNodeData
      // Generate branches from categories + unmatched
      if (classifierData.categories) {
        return [
          ...classifierData.categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            type: 'default',
          })),
          { id: 'unmatched', name: 'Unmatched', type: 'default' },
        ]
      }
      return undefined
    }

    case NodeType.HTTP: {
      const httpData = nodeData as HttpNodeData
      const branches = [{ id: 'source', name: '', type: 'default' }]
      // Add fail branch if error strategy is set to fail
      if (httpData.error_strategy === ErrorStrategy.fail) {
        branches.push({ id: 'fail', name: 'Fail', type: 'fail' })
      }
      return branches
    }

    case NodeType.CRUD: {
      const crudData = nodeData as CrudNodeData
      const branches = [{ id: 'source', name: '', type: 'default' }]

      // Add fail branch if error strategy is set to fail
      if (crudData.error_strategy === 'fail') {
        branches.push({ id: 'fail', name: 'Fail', type: 'fail' })
      }

      return branches
    }

    default:
      return undefined
  }
}

/**
 * Main initialization function for workflow nodes and edges
 * Ensures all nodes have proper connection metadata and edges have required data
 */
export const initializeWorkflow = (
  nodes: FlowNode[],
  edges: FlowEdge[]
): { nodes: FlowNode[]; edges: FlowEdge[] } => {
  // Preprocess to handle loop nodes and their start nodes
  const preprocessed = preprocessNodesAndEdges(nodes, edges)

  // Initialize all node properties including connection metadata
  const initializedNodes = initialNodes(preprocessed.nodes, preprocessed.edges)

  // Initialize edge data with source/target types and loop context
  const initializedEdges = initialEdges(preprocessed.edges, initializedNodes)

  return { nodes: initializedNodes, edges: initializedEdges }
}

/**
 * Preprocess nodes and edges to handle loop nodes and their start nodes
 */
export const preprocessNodesAndEdges = (
  nodes: FlowNode[],
  edges: FlowEdge[]
): { nodes: FlowNode[]; edges: FlowEdge[] } => {
  const processedNodes = [...nodes]
  const processedEdges = [...edges]

  // Process each loop node
  nodes.forEach((node) => {
    if (node.data.type === NodeType.LOOP) {
      const loopData = node.data as LoopNodeData

      // Check if loop has a start_node_id
      // if (!loopData.start_node_id) {
      //   // Create a loop start node
      //   const startNodeId = generateId()
      //   const startNode: FlowNode = {
      //     id: startNodeId,
      //     type: 'loop-start',
      //     position: { x: node.position.x + 50, y: node.position.y + 100 },
      //     data: {
      //       id: startNodeId,
      //       type: 'loop-start' as any, // Special internal type
      //       title: 'Loop Start',
      //       desc: '',
      //       icon: 'play',
      //       isValid: true,
      //       _connectedSourceHandleIds: [],
      //       _connectedTargetHandleIds: [],
      //       config: {} as any,
      //     },
      //     parentId: node.id,
      //   }

      //   // Add the start node
      //   processedNodes.push(startNode)

      //   // Update loop node with start_node_id
      //   loopData.start_node_id = startNodeId

      //   // Find the first child node of the loop
      //   const loopChildren = processedNodes.filter((n) => n.parentId === node.id)
      //   if (loopChildren.length > 0) {
      //     // Create edge from start node to first child
      //     const firstChild = loopChildren[0]
      //     const startEdge: FlowEdge = {
      //       id: generateID(),
      //       source: startNodeId,
      //       target: firstChild.id,
      //       sourceHandle: 'source',
      //       targetHandle: 'target',
      //       data: {
      //         sourceType: 'loop-start',
      //         targetType: firstChild.data.type,
      //         isInLoop: true,
      //         loopId: node.id,
      //       },
      //     }
      //     processedEdges.push(startEdge)
      //   }
      // }
    }
  })

  return { nodes: processedNodes, edges: processedEdges }
}

/**
 * Initialize all node properties including connection metadata
 */
export const initialNodes = (nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] => {
  // Build parent-child relationship map
  const childrenMap = nodes.reduce(
    (acc, node) => {
      if (node.parentId) {
        if (!acc[node.parentId]) acc[node.parentId] = []
        acc[node.parentId].push({ nodeId: node.id, nodeType: node.data.type })
      }
      return acc
    },
    {} as Record<string, Array<{ nodeId: string; nodeType: string }>>
  )

  // Build loop context map
  const loopParentMap = nodes.reduce(
    (acc, node) => {
      if (node.parentId) {
        const parentNode = nodes.find((n) => n.id === node.parentId)
        if (parentNode?.data.type === NodeType.LOOP) {
          acc[node.id] = node.parentId
        }
      }
      return acc
    },
    {} as Record<string, string>
  )

  return nodes.map((node) => {
    // Create a copy to avoid mutation
    const updatedNode = { ...node, data: { ...node.data } }

    // NOTE: defaultData enrichment is intentionally skipped here because app blocks
    // may not be registered yet. This enrichment now happens in WorkflowEditor
    // after blocks are loaded. See workflow-editor.tsx WorkflowEditorInner.enrichedNodes

    // Initialize connection metadata for ALL nodes
    const connectedEdges = getConnectedEdges([node], edges)

    // Initialize arrays if they don't exist
    if (!updatedNode.data._connectedSourceHandleIds) {
      updatedNode.data._connectedSourceHandleIds = []
    }
    if (!updatedNode.data._connectedTargetHandleIds) {
      updatedNode.data._connectedTargetHandleIds = []
    }

    // Update connection metadata
    updatedNode.data._connectedSourceHandleIds = connectedEdges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.sourceHandle || 'source')

    updatedNode.data._connectedTargetHandleIds = connectedEdges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.targetHandle || 'target')

    // Initialize loop context
    if (loopParentMap[node.id]) {
      updatedNode.data.isInLoop = true
      updatedNode.data.loopId = loopParentMap[node.id]
    }

    // Calculate and set _targetBranches for all applicable node types
    const targetBranches = calculateTargetBranches(updatedNode.data)
    if (targetBranches) {
      updatedNode.data._targetBranches = targetBranches
    }

    // Handle node-specific dynamic properties
    if (node.data.type === NodeType.LOOP) {
      const loopData = updatedNode.data as LoopNodeData
      // Set _children based on parent-child relationships
      loopData._children = childrenMap[node.id] || []
    }
    updatedNode.type = node.data.type === NodeType.NOTE ? 'note' : 'standard'
    return updatedNode
  })
}

/**
 * Initialize edge data with source/target types and loop context
 */
export const initialEdges = (edges: FlowEdge[], nodes: FlowNode[]): FlowEdge[] => {
  // Create node map for quick lookups
  const nodesMap = nodes.reduce(
    (acc, node) => {
      acc[node.id] = node
      return acc
    },
    {} as Record<string, FlowNode>
  )

  return edges.map((edge) => {
    // Create a copy to avoid mutation
    const edgeData: EdgeData = { ...(edge.data || {}) } as EdgeData
    const updatedEdge: FlowEdge = { ...edge, data: edgeData }

    // Set source and target types
    const sourceNode = nodesMap[edge.source]
    const targetNode = nodesMap[edge.target]

    if (sourceNode && updatedEdge.data) {
      updatedEdge.data.sourceType = sourceNode.data.type
    }
    if (targetNode && updatedEdge.data) {
      updatedEdge.data.targetType = targetNode.data.type
    }

    // Set loop context
    const sourceInLoop = sourceNode?.data.isInLoop
    const targetInLoop = targetNode?.data.isInLoop
    const sourceLoopId = sourceNode?.data.loopId
    const targetLoopId = targetNode?.data.loopId

    // Edge is in a loop if both nodes are in the same loop
    if (sourceInLoop && targetInLoop && sourceLoopId === targetLoopId && updatedEdge.data) {
      updatedEdge.data.isInLoop = true
      updatedEdge.data.loopId = sourceLoopId
    }

    // Check if this is a loop back edge (from loop exit to loop node)
    if (
      targetNode?.data.type === NodeType.LOOP &&
      sourceNode?.parentId === targetNode.id &&
      updatedEdge.data
    ) {
      updatedEdge.data.isLoopBackEdge = true
    }

    // Ensure handles have defaults
    if (!updatedEdge.sourceHandle) {
      updatedEdge.sourceHandle = 'source'
    }
    if (!updatedEdge.targetHandle) {
      updatedEdge.targetHandle = 'target'
    }

    // Calculate and set zIndex for the edge
    updatedEdge.zIndex = calculateZIndex(updatedEdge, nodes)
    return updatedEdge
  })
}

/**
 * Detect cycles in the workflow graph
 * Returns array of edge IDs that form cycles
 */
export const getCycleEdges = (nodes: FlowNode[], edges: FlowEdge[]): string[] => {
  const cycleEdges: string[] = []
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  // Build adjacency list
  const adjacencyList = edges.reduce(
    (acc, edge) => {
      if (!acc[edge.source]) {
        acc[edge.source] = []
      }
      acc[edge.source]!.push({ target: edge.target, edgeId: edge.id })
      return acc
    },
    {} as Record<string, Array<{ target: string; edgeId: string }>>
  )

  // DFS to detect cycles
  const hasCycle = (nodeId: string, path: string[] = []): boolean => {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const neighbors = adjacencyList[nodeId] || []
    for (const { target, edgeId } of neighbors) {
      // Skip if this edge connects to a loop node (loop back edges are allowed)
      const targetNode = nodes.find((n) => n.id === target)
      if (targetNode?.data.type === NodeType.LOOP) {
        continue
      }

      if (!visited.has(target)) {
        if (hasCycle(target, [...path, edgeId])) {
          return true
        }
      } else if (recursionStack.has(target)) {
        // Found a cycle - add the edge that completes the cycle
        cycleEdges.push(edgeId)
        return true
      }
    }

    recursionStack.delete(nodeId)
    return false
  }

  // Check each unvisited node
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      hasCycle(node.id)
    }
  })

  return cycleEdges
}

/**
 * Validate if nodes and edges have required initialization properties
 */
export const validateInitialization = (
  nodes: FlowNode[],
  edges: FlowEdge[]
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Check nodes
  nodes.forEach((node) => {
    if (!node.data._connectedSourceHandleIds) {
      errors.push(`Node ${node.id} missing _connectedSourceHandleIds`)
    }
    if (!node.data._connectedTargetHandleIds) {
      errors.push(`Node ${node.id} missing _connectedTargetHandleIds`)
    }

    // Check node-specific requirements
    if (node.data.type === NodeType.LOOP) {
      const loopData = node.data as LoopNodeData
      if (!loopData._children) {
        errors.push(`Loop node ${node.id} missing _children`)
      }
    }

    // Check _targetBranches for nodes that should have them
    if ([NodeType.IF_ELSE, NodeType.TEXT_CLASSIFIER].includes(node.data.type as NodeType)) {
      if (!node.data._targetBranches) {
        errors.push(`Node ${node.id} (${node.data.type}) missing _targetBranches`)
      }
    }
  })

  // Check edges
  edges.forEach((edge) => {
    if (!edge.data) {
      errors.push(`Edge ${edge.id} missing data object`)
    } else {
      if (!edge.data.sourceType) {
        errors.push(`Edge ${edge.id} missing sourceType`)
      }
      if (!edge.data.targetType) {
        errors.push(`Edge ${edge.id} missing targetType`)
      }
    }
  })

  return { valid: errors.length === 0, errors }
}

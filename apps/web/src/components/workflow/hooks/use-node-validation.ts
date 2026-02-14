// apps/web/src/components/workflow/utils/connection-validation.ts

import { type Connection, type Edge, getOutgoers, type Node, useStoreApi } from '@xyflow/react'
import { LOOP_HANDLES } from '../nodes/core/loop/constants'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { NodeType } from '../types/node-types'
import { NodeCategory } from '../types/registry'

/**
 * Hook for node validation utilities
 */
export function useNodeValidation() {
  const store = useStoreApi()

  // Maximum parallel connections from a single node handle
  const PARALLEL_LIMIT = 10

  /**
   * Checks if a source node is inside a loop node
   */
  const isNodeInsideLoop = (sourceId: string, loopId: string, nodes: Node[]): boolean => {
    const sourceNode = nodes.find((n) => n.id === sourceId)
    if (!sourceNode) return false

    // Check direct parent
    if (sourceNode.parentId === loopId) return true

    // Check ancestor chain
    let current = sourceNode
    while (current.parentId) {
      if (current.parentId === loopId) return true
      const parent = nodes.find((n) => n.id === current.parentId)
      if (!parent) break
      current = parent
    }

    return false
  }

  /**
   * Checks if a node can connect from inside a loop
   */
  const canConnectFromInsideLoop = (
    sourceId: string,
    targetId: string,
    targetHandle: string,
    nodes: Node[]
  ): boolean => {
    const sourceNode = nodes.find((n) => n.id === sourceId)
    if (!sourceNode) return false

    // If source has loopId, it's inside a loop
    if (sourceNode.data?.loopId) {
      // Can only connect to LOOP_BACK or nodes with same loopId
      if (targetHandle === LOOP_HANDLES.LOOP_BACK) return true

      // Check if target has same loopId
      const targetNode = nodes.find((n) => n.id === targetId)
      return targetNode?.data?.loopId === sourceNode.data.loopId
    }

    return true // Not in loop, normal rules apply
  }

  /**
   * Checks if two handles are compatible for connection
   * Prevents source-to-source and target-to-target connections
   */
  const areHandlesCompatible = (sourceHandle: string, targetHandle: string): boolean => {
    // Define source handles (outputs)
    const sourceHandles = [
      'source',
      'false', // if-else node's else handle
      'true', // if-else node's true handle
      LOOP_HANDLES.LOOP_START,
      LOOP_HANDLES.LOOP_BACK, // Loop exit handle (early exit from loop)
    ]

    // Define target handles (inputs)
    const targetHandles = [
      'target',
      'input', // NEW: Input handle for manual trigger nodes
      LOOP_HANDLES.LOOP_BACK, // Loop back handle (iteration restart)
    ]

    // Define input source handles (outputs from input nodes)
    const inputSourceHandles = [
      'input-output', // NEW: Output from input nodes
    ]

    // NEW: Input nodes can only connect to input handles
    if (inputSourceHandles.includes(sourceHandle)) {
      return targetHandle === 'input'
    }

    // NEW: Input handles can only receive from input nodes
    if (targetHandle === 'input') {
      return inputSourceHandles.includes(sourceHandle)
    }

    // Cannot connect source to source
    if (sourceHandles.includes(sourceHandle) && sourceHandles.includes(targetHandle)) {
      return false
    }

    // Cannot connect target to target
    if (targetHandles.includes(sourceHandle) && targetHandles.includes(targetHandle)) {
      return false
    }

    // Special case: if-else case IDs are source handles
    // Case IDs are dynamic (UUIDs), so we need to check differently
    // If the source handle is not in our known lists but target is a target handle, it's likely a case ID
    const isLikelySourceHandle = !targetHandles.includes(sourceHandle)
    const isLikelyTargetHandle = !sourceHandles.includes(targetHandle)

    // If both are likely source handles or both are likely target handles, reject
    if (isLikelySourceHandle && !isLikelyTargetHandle && sourceHandles.includes(targetHandle)) {
      return false // source to source
    }
    if (!isLikelySourceHandle && isLikelyTargetHandle && targetHandles.includes(sourceHandle)) {
      return false // target to target
    }

    return true
  }

  /**
   * Validates whether a connection between two nodes is allowed
   * @param connection - The connection to validate
   * @returns true if the connection is valid, false otherwise
   */
  const isValidConnection = (connection: Connection): boolean => {
    const { nodes, edges } = store.getState()

    // Basic validation
    if (!connection.source || !connection.target) {
      return false
    }

    // Prevent self-connections
    if (connection.source === connection.target) {
      return false
    }

    // Get nodes from the nodes array
    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    if (!sourceNode || !targetNode) {
      return false
    }

    // Check if source is note type node
    if (sourceNode.type === NodeType.NOTE) {
      return false
    }

    // Check handle compatibility (prevent source-to-source and target-to-target)
    const sourceHandle = connection.sourceHandle || 'source'
    const targetHandle = connection.targetHandle || 'target'

    if (!areHandlesCompatible(sourceHandle, targetHandle)) {
      return false
    }

    // Check parallel limit
    const sourceEdges = edges.filter(
      (edge) =>
        edge.source === connection.source &&
        edge.sourceHandle === (connection.sourceHandle || 'source')
    )
    if (sourceEdges.length >= PARALLEL_LIMIT) {
      return false
    }

    // Loop-specific handle validation
    if (connection.sourceHandle === LOOP_HANDLES.LOOP_START) {
      // LOOP_START can only connect to nodes inside the loop
      const targetHasLoopId = targetNode.data?.loopId === sourceNode.id
      if (!targetHasLoopId) {
        return false
      }
    }

    // Prevent connecting TO LOOP_START (it's a source handle)
    if (connection.targetHandle === LOOP_HANDLES.LOOP_START) {
      return false
    }

    // Validate LOOP_BACK connections (nodes inside loop connecting back to restart iteration)
    if (connection.targetHandle === LOOP_HANDLES.LOOP_BACK) {
      // The LOOP_BACK handle is on the loop node itself
      // Check if source node is inside this loop
      const sourceLoopId = sourceNode.data?.loopId
      const sourceParentId = sourceNode.parentId

      // The target of LOOP_BACK connection should be the loop node that has the loop-back handle
      const isInsideTargetLoop =
        // Direct child of the loop
        sourceParentId === targetNode.id ||
        // Has loopId matching the loop node
        sourceLoopId === targetNode.id ||
        // For nested scenarios (shouldn't happen with current design)
        (sourceLoopId && targetNode.data?.type === NodeType.LOOP && sourceLoopId === targetNode.id)

      if (!isInsideTargetLoop) {
        return false
      }
    }

    // Check if node inside loop tries to connect outside (except to LOOP_BACK)
    if (sourceNode.data?.loopId && targetNode.data?.loopId !== sourceNode.data.loopId) {
      if (connection.targetHandle !== LOOP_HANDLES.LOOP_BACK) {
        return false
      }
      // If connecting to LOOP_BACK, verify it's the correct loop
      if (
        connection.targetHandle === LOOP_HANDLES.LOOP_BACK &&
        sourceNode.data.loopId !== targetNode.id
      ) {
        return false
      }
    }

    // Check node type compatibility (using data.type as that's where the type is stored)
    const startTriggerNodes = unifiedNodeRegistry.startTriggerNodes
    const sourceType = sourceNode.data?.type || sourceNode.type
    const targetType = targetNode.data?.type || targetNode.type

    if (sourceType && targetType) {
      // NEW: Special handling for input nodes
      const sourceDefinition = unifiedNodeRegistry.getDefinition(sourceType)
      const targetDefinition = unifiedNodeRegistry.getDefinition(targetType)

      // Input nodes can only connect to nodes that accept input connections
      if (sourceDefinition?.category === NodeCategory.INPUT) {
        if (!targetDefinition?.acceptsInputNodes) {
          return false
        }
        // Input nodes must connect via input handle
        if (connection.targetHandle !== 'input') {
          return false
        }
        return true // Input node connection is valid
      }

      const sourceNodeAvailableNextNodes = unifiedNodeRegistry.availableNextNodesForType(sourceType)
      const targetNodeAvailablePrevNodes = [
        ...unifiedNodeRegistry.availablePrevNodesForType(targetType),
        ...startTriggerNodes,
      ]

      if (!sourceNodeAvailableNextNodes.includes(targetType)) {
        return false
      }

      if (!targetNodeAvailablePrevNodes.includes(sourceType)) {
        return false
      }
    }

    // Check for cycles in the graph
    const hasCycle = (node: Node, visited = new Set<string>()): boolean => {
      // Skip cycle check for loop internal connections
      if (sourceNode.data?.loopId && targetNode.data?.loopId === sourceNode.data.loopId) {
        return false // Internal loop connections are handled by loop logic
      }

      if (visited.has(node.id)) return false
      visited.add(node.id)

      for (const outgoer of getOutgoers(node, nodes, edges)) {
        if (outgoer.id === connection.source) return true
        if (hasCycle(outgoer, visited)) return true
      }
      return false
    }

    // Skip cycle check for LOOP_BACK connections (they are intentional cycles)
    if (
      connection.targetHandle === LOOP_HANDLES.LOOP_BACK ||
      connection.targetHandle === 'source' // changed from LOOP_EXIT
    ) {
      console.log(
        '[isValidConnection] Skipping cycle check for loop handle:',
        connection.targetHandle
      )
    } else if (hasCycle(targetNode)) {
      return false
    }

    // Check for duplicate connections
    const existingEdge = edges.find(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle
    )

    if (existingEdge) {
      return false
    }

    return true
  }

  /**
   * Checks if a node has reached the parallel connection limit
   * @param nodeId - The node ID to check
   * @param nodeHandle - The handle to check (default: 'source')
   * @returns true if the node can accept more connections, false if limit reached
   */
  const checkParallelLimit = (nodeId: string, nodeHandle = 'source'): boolean => {
    const { edges } = store.getState()
    const connectedEdges = edges.filter(
      (edge) => edge.source === nodeId && edge.sourceHandle === nodeHandle
    )
    return connectedEdges.length < PARALLEL_LIMIT
  }

  /**
   * Get the parallel connection limit constant
   */
  const getParallelLimit = (): number => {
    return PARALLEL_LIMIT
  }

  return {
    isNodeInsideLoop,
    canConnectFromInsideLoop,
    isValidConnection,
    checkParallelLimit,
    getParallelLimit,
    areHandlesCompatible,
  }
}

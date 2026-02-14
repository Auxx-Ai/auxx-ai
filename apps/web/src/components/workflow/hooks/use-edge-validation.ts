// apps/web/src/components/workflow/hooks/use-edge-validation.ts

import { type Connection, type Edge, useReactFlow } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { EdgeValidationService } from '../services/edge-validation-service'

/**
 * Hook that provides edge validation functionality using ReactFlow state
 * Wraps the EdgeValidationService with React hooks for reactive updates
 */
export const useEdgeValidation = () => {
  const { getEdges, getNodes, getNode } = useReactFlow()

  /**
   * Check if a connection between two nodes is valid
   */
  const isValidConnection = useCallback(
    (connection: Connection): boolean => {
      const edges = getEdges()
      return EdgeValidationService.isValidConnection(connection, edges)
    },
    [getEdges]
  )

  /**
   * Create edge data based on source and target nodes
   */
  const createEdgeData = useCallback(
    (connection: Connection) => {
      const sourceNode = getNode(connection.source!)
      const targetNode = getNode(connection.target!)

      if (!sourceNode || !targetNode) {
        console.warn('Source or target node not found for connection:', connection)
        return {}
      }

      return EdgeValidationService.createEdgeData(sourceNode, targetNode, connection)
    },
    [getNode]
  )

  /**
   * Validate an edge and return any errors
   */
  const getEdgeValidationErrors = useCallback(
    (edgeId: string): string[] => {
      const edges = getEdges()
      const edge = edges.find((e) => e.id === edgeId)

      if (!edge) {
        return [`Edge ${edgeId} not found`]
      }

      return EdgeValidationService.getEdgeValidationErrors(edge)
    },
    [getEdges]
  )

  /**
   * Check if a node has reached its parallel connection limit
   */
  const checkParallelLimit = useCallback(
    (nodeId: string, nodeHandle: string = 'source', limit: number = 10): boolean => {
      const edges = getEdges()
      return EdgeValidationService.checkParallelLimit(nodeId, nodeHandle, edges, limit)
    },
    [getEdges]
  )

  /**
   * Get all edges connected to a specific node
   */
  const getConnectedEdges = useCallback(
    (nodeId: string): Edge[] => {
      const edges = getEdges()
      return EdgeValidationService.getConnectedEdges(nodeId, edges)
    },
    [getEdges]
  )

  /**
   * Get edges by node and connection type
   */
  const getEdgesByNode = useCallback(
    (nodeId: string, type?: 'source' | 'target'): Edge[] => {
      const edges = getEdges()
      return EdgeValidationService.getEdgesByNode(nodeId, edges, type)
    },
    [getEdges]
  )

  /**
   * Create a unique edge ID
   */
  const createEdgeId = useCallback((connection: Connection): string => {
    return EdgeValidationService.createEdgeId(connection)
  }, [])

  /**
   * Get validation status for all edges (memoized)
   */
  const validationStatus = useMemo(() => {
    const edges = getEdges()
    const results: Record<string, { isValid: boolean; errors: string[] }> = {}
    let totalErrors = 0

    edges.forEach((edge) => {
      const errors = EdgeValidationService.getEdgeValidationErrors(edge)
      const isValid = errors.length === 0
      results[edge.id] = { isValid, errors }
      totalErrors += errors.length
    })

    return {
      results,
      hasErrors: totalErrors > 0,
      totalErrors,
    }
  }, [getEdges])

  /**
   * Check if any node has exceeded its connection limits
   */
  const connectionLimitStatus = useMemo(() => {
    const nodes = getNodes()
    const edges = getEdges()
    const nodesAtLimit: string[] = []

    nodes.forEach((node) => {
      // Check source connections (default limit of 10)
      if (!EdgeValidationService.checkParallelLimit(node.id, 'source', edges, 10)) {
        nodesAtLimit.push(node.id)
      }
    })

    return {
      hasNodesAtLimit: nodesAtLimit.length > 0,
      nodesAtLimit,
    }
  }, [getNodes, getEdges])

  /**
   * Find duplicate edges
   */
  const findDuplicateEdges = useCallback((): Edge[] => {
    const edges = getEdges()
    const duplicates: Edge[] = []
    const seen = new Set<string>()

    edges.forEach((edge) => {
      const key = `${edge.source}-${edge.sourceHandle}-${edge.target}-${edge.targetHandle}`
      if (seen.has(key)) {
        duplicates.push(edge)
      } else {
        seen.add(key)
      }
    })

    return duplicates
  }, [getEdges])

  /**
   * Check if adding a connection would create a cycle
   */
  const wouldCreateCycle = useCallback(
    (connection: Connection): boolean => {
      const edges = getEdges()
      const { source, target } = connection

      if (!source || !target) return false

      // Simple cycle detection - check if there's already a path from target to source
      const visited = new Set<string>()
      const queue = [target]

      while (queue.length > 0) {
        const current = queue.shift()!

        if (current === source) {
          return true // Found a cycle
        }

        if (!visited.has(current)) {
          visited.add(current)

          // Add all nodes that current connects to
          edges.forEach((edge) => {
            if (edge.source === current && !visited.has(edge.target)) {
              queue.push(edge.target)
            }
          })
        }
      }

      return false
    },
    [getEdges]
  )

  return {
    // Validation methods
    isValidConnection,
    getEdgeValidationErrors,
    validationStatus,

    // Connection limit methods
    checkParallelLimit,
    connectionLimitStatus,

    // Edge query methods
    getConnectedEdges,
    getEdgesByNode,
    findDuplicateEdges,

    // Edge creation
    createEdgeData,
    createEdgeId,

    // Advanced validation
    wouldCreateCycle,
  }
}

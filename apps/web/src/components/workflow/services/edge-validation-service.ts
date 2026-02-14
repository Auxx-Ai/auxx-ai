// apps/web/src/components/workflow/services/edge-validation-service.ts

import type { Connection, Edge, Node } from '@xyflow/react'

/**
 * Edge validation service
 * Contains pure business logic for validating edges without state management
 */
export class EdgeValidationService {
  /**
   * Check if a connection between two nodes is valid
   */
  static isValidConnection(connection: Connection, edges: Edge[]): boolean {
    // Basic validation
    if (!connection.source || !connection.target) {
      return false
    }

    // Prevent self-connections
    if (connection.source === connection.target) {
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
   * Create edge data based on source and target nodes
   */
  static createEdgeData(sourceNode: Node, targetNode: Node, connection: Connection) {
    // Determine if this is a loop back edge
    const isLoopBackEdge = targetNode?.type === 'loop' && connection.targetHandle === 'loop-back'

    return {
      sourceType: sourceNode?.data?.type || '',
      targetType: targetNode?.data?.type || '',
      isLoopBackEdge,
      // Additional data can be added here based on node types
    }
  }

  /**
   * Validate an edge and return any errors
   */
  static getEdgeValidationErrors(edge: Edge): string[] {
    const errors: string[] = []

    // Basic validation
    if (!edge.source || !edge.target) {
      errors.push('Edge must have source and target')
    }

    // Add more validation rules here as needed
    // For example, checking node type compatibility

    return errors
  }

  /**
   * Check if a node has reached its parallel connection limit
   */
  static checkParallelLimit(
    nodeId: string,
    nodeHandle: string = 'source',
    edges: Edge[],
    limit: number = 10
  ): boolean {
    const connectedEdges = edges.filter(
      (edge) => edge.source === nodeId && edge.sourceHandle === nodeHandle
    )
    return connectedEdges.length < limit
  }

  /**
   * Get all edges connected to a specific node
   */
  static getConnectedEdges(nodeId: string, edges: Edge[]): Edge[] {
    return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
  }

  /**
   * Get edges by node and connection type
   */
  static getEdgesByNode(nodeId: string, edges: Edge[], type?: 'source' | 'target'): Edge[] {
    if (type === 'source') {
      return edges.filter((edge) => edge.source === nodeId)
    } else if (type === 'target') {
      return edges.filter((edge) => edge.target === nodeId)
    }

    return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
  }

  /**
   * Create a unique edge ID
   */
  static createEdgeId(connection: Connection): string {
    return [
      connection.source,
      connection.sourceHandle || 'default',
      connection.target,
      connection.targetHandle || 'default',
      Date.now(),
    ].join('-')
  }
}

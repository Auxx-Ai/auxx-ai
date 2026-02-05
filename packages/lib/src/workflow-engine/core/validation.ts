// packages/lib/src/workflow-engine/core/validation.ts

import { createScopedLogger } from '@auxx/logger'
import type { Workflow } from './types'
import { isNonExecutableNodeType } from './types'
import type { NodeProcessorRegistry } from './node-processor-registry'
import { isTerminalNodeType } from '../utils/terminal-nodes'
import { findEntryNode } from './graph-navigation'

const logger = createScopedLogger('workflow-validation')

/**
 * Validate workflow structure and node configurations
 * Uses findEntryNode from graph-navigation module
 */
export async function validateWorkflow(
  workflow: Workflow,
  nodeRegistry: NodeProcessorRegistry
): Promise<void> {
  const errors: string[] = []

  // Check for entry point using findEntryNode
  const entryNode = findEntryNode(workflow)
  if (!entryNode) {
    errors.push('No valid entry point found')
  }

  // Validate all nodes have processors (skip non-executable UI-only nodes)
  for (const node of workflow.nodes) {
    // Skip UI-only nodes that don't have processors (e.g., input nodes, notes)
    if (isNonExecutableNodeType(node.type)) {
      continue
    }

    const processor = await nodeRegistry.getProcessor(node.type)
    if (!processor) {
      errors.push(`No processor available for node type: ${node.type}`)
      continue
    }

    try {
      const validation = await processor.validate(node)
      if (!validation.valid) {
        errors.push(`Node ${node.nodeId}: ${validation.errors.join(', ')}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Node validation error', {
        nodeId: node.nodeId,
        nodeType: node.type,
        nodeName: node.name,
        error: errorMessage,
        nodeData: node.data,
      })
      errors.push(`Node ${node.nodeId} (${node.type}): ${errorMessage}`)
    }
  }

  // Check for orphaned nodes using edges
  const referencedNodes = new Set<string>()
  const nodesWithOutgoingConnections = new Set<string>()

  // Use edges to track connections
  if (workflow.graph?.edges) {
    workflow.graph.edges.forEach((edge) => {
      nodesWithOutgoingConnections.add(edge.source)
      referencedNodes.add(edge.target)
    })
  }

  // Find truly orphaned nodes (no incoming connections and not an entry point)
  // Exclude non-executable nodes (form-input, file-upload, number-input, note)
  // since they're source/annotation nodes that don't require incoming connections
  const orphanedNodes = workflow.nodes.filter(
    (node) =>
      node !== entryNode &&
      !referencedNodes.has(node.nodeId) &&
      !isNonExecutableNodeType(node.type)
  )

  if (orphanedNodes.length > 0) {
    // Log warning instead of error for orphaned nodes
    logger.warn('Orphaned nodes found (no incoming connections)', {
      workflowId: workflow.id,
      nodes: orphanedNodes.map((n) => ({ nodeId: n.nodeId, type: n.type })),
    })
  }

  // Check for non-terminal nodes without outgoing connections
  const nonTerminalNodesWithoutConnections = workflow.nodes.filter((node) => {
    const hasNoOutgoingConnections = !nodesWithOutgoingConnections.has(node.nodeId)
    const isNotTerminal = !isTerminalNodeType(node.type)
    return hasNoOutgoingConnections && isNotTerminal
  })

  if (nonTerminalNodesWithoutConnections.length > 0) {
    // Log warning instead of error
    logger.warn('Non-terminal nodes found without outgoing connections', {
      workflowId: workflow.id,
      nodes: nonTerminalNodesWithoutConnections.map((n) => ({ nodeId: n.nodeId, type: n.type })),
    })
  }

  if (errors.length > 0) {
    throw new Error(`Workflow validation failed: ${errors.join('; ')}`)
  }
}

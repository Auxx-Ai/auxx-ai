// packages/lib/src/workflow-engine/core/graph-navigation.ts

import type { NodeExecutionResult, Workflow, WorkflowEdge, WorkflowNode } from './types'
import { WorkflowTriggerType } from './types'
import { type WorkflowGraph, WorkflowGraphHelper } from './workflow-graph-builder'

/**
 * Find the entry point node in the workflow
 * Supports multiple trigger types and matches against workflow's trigger type
 */
export function findEntryNode(workflow: Workflow): WorkflowNode | undefined {
  // Look for trigger nodes - these are the entry points
  const triggerNodeTypes = Object.values(WorkflowTriggerType)

  const triggerNodes = workflow.nodes.filter((node) =>
    triggerNodeTypes.includes(node.type as WorkflowTriggerType)
  )

  if (triggerNodes.length === 0) {
    return undefined
  }

  // Find the trigger node that matches the workflow's trigger type
  // Since trigger types and node types are now aligned (both use -trigger suffix), we can compare directly
  const matchingTrigger = triggerNodes.find((node) => node.type === workflow.triggerType.toString())

  return matchingTrigger || triggerNodes[0]
}

/**
 * Find a node by ID in the workflow
 */
export function findNodeById(workflow: Workflow, nodeId?: string): WorkflowNode | null {
  if (!nodeId) return null
  return workflow.nodes.find((node) => node.nodeId === nodeId) || null
}

/**
 * Get target node IDs from a specific handle
 */
export function getTargetsFromHandle(
  edges: WorkflowEdge[],
  nodeId: string,
  handle: string
): string[] {
  return edges
    .filter((edge) => edge.source === nodeId && edge.sourceHandle === handle)
    .map((edge) => edge.target)
}

/**
 * Get next node IDs based on node execution result and output handle
 *
 * All nodes return a single outputHandle (not the plural outputHandles array).
 * The outputHandles property exists in the type but is never used ("future use").
 *
 * @param node - The current node
 * @param result - Node execution result with output handle information
 * @param graph - Workflow graph for navigation
 * @returns Array of next node IDs to execute
 */
export function getNextNodeIds(
  node: WorkflowNode,
  result: NodeExecutionResult,
  graph: WorkflowGraph
): string[] {
  const outputHandle = result.outputHandle || 'source'
  const nextNodes = WorkflowGraphHelper.getNextNodes(graph, node.nodeId, outputHandle)
  return nextNodes.map((n) => n.nodeId)
}

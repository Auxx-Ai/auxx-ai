// packages/lib/src/workflow-engine/core/pause-resume.ts

import { WorkflowGraphHelper, type WorkflowGraph } from './workflow-graph-builder'
import { WorkflowNodeType, type WorkflowNode, type PauseReason } from './types'

/**
 * Determine if a pause should terminate the entire workflow vs just the branch
 *
 * @param pauseReason - The reason for the pause
 * @param isInBranchContext - Whether the pause occurred within a parallel branch
 * @returns True if the pause should terminate the workflow, false if only the branch
 */
export function shouldPauseBeTerminal(
  pauseReason: PauseReason,
  isInBranchContext: boolean
): boolean {
  // Sequential execution pauses are always terminal
  if (!isInBranchContext) {
    return true
  }
  // In parallel execution, check pause type and configuration
  switch (pauseReason.type) {
    case 'human_confirmation':
      // Manual confirmations in branches are typically non-terminal
      // unless explicitly configured as terminal
      return pauseReason.metadata?.terminalPause ?? false
    case 'wait':
      // Wait nodes in branches are typically non-terminal
      // unless it's a very long wait or explicitly configured
      return pauseReason.metadata?.terminalPause ?? false
    default:
      // Default to non-terminal for branch context
      return pauseReason.metadata?.terminalPause ?? false
  }
}

/**
 * Get next nodes for human confirmation based on output
 *
 * @param node - The human confirmation node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getHumanConfirmationNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  let handle = 'source'
  if (nodeOutput?.outcome === 'approve') {
    handle = 'approved'
  } else if (nodeOutput?.outcome === 'deny') {
    handle = 'denied'
  } else if (nodeOutput?.outcome === 'timeout') {
    handle = 'timeout'
  }
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * Get next nodes for wait node
 *
 * @param node - The wait node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getWaitNodeNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  const handle = nodeOutput?.timeout ? 'timeout' : 'source'
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * Get next nodes for conditional node
 *
 * @param node - The conditional (if-else) node
 * @param nodeOutput - The output from the node execution
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function getConditionalNextNodes(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  const handle = nodeOutput?.outputHandle || (nodeOutput?.result ? 'true' : 'false')
  return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, handle).map((n) => n.nodeId)
}

/**
 * Determine next nodes to execute when resuming from a paused node
 *
 * @param node - The paused node being resumed
 * @param nodeOutput - The output from the resumed node
 * @param graph - The workflow graph
 * @returns Array of next node IDs to execute
 */
export function determineNextNodesForResume(
  node: WorkflowNode,
  nodeOutput: any,
  graph: WorkflowGraph
): string[] {
  // Special handling for specific node types
  switch (node.type) {
    case WorkflowNodeType.HUMAN_CONFIRMATION:
      return getHumanConfirmationNextNodes(node, nodeOutput, graph)
    case WorkflowNodeType.WAIT:
      return getWaitNodeNextNodes(node, nodeOutput, graph)
    case WorkflowNodeType.IF_ELSE:
      return getConditionalNextNodes(node, nodeOutput, graph)
    default:
      // Standard output handle resolution
      const outputHandle = nodeOutput?.outputHandle || 'source'
      return WorkflowGraphHelper.getNextNodes(graph, node.nodeId, outputHandle).map((n) => n.nodeId)
  }
}

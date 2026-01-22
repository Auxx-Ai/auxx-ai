// apps/web/src/components/workflow/utils/trigger-type-mapper.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'

/**
 * Maps between node IDs and workflow trigger types
 * Since backend types now match frontend types (both kebab-case), mapping is straightforward
 */

/**
 * Convert a node ID to its corresponding workflow trigger type
 * @param nodeId The node ID (e.g., 'message-received')
 * @returns The workflow trigger type (e.g., 'message-received') or undefined if not a trigger node
 */
export function nodeIdToTriggerTypeMapper(nodeId: string): WorkflowTriggerType | undefined {
  // Simple validation check - node ID should match a trigger type value
  const validTriggerTypes = Object.values(WorkflowTriggerType)
  return validTriggerTypes.includes(nodeId as WorkflowTriggerType)
    ? (nodeId as WorkflowTriggerType)
    : undefined
}

/**
 * Convert a workflow trigger type to its corresponding node ID
 * @param triggerType The workflow trigger type (e.g., 'message-received')
 * @returns The node ID (e.g., 'message-received')
 */
export function triggerTypeToNodeIdMapper(triggerType: WorkflowTriggerType): string {
  // Since types are aligned, trigger type is the same as node ID
  return triggerType
}

/**
 * Check if a node ID corresponds to a trigger node
 * @param nodeId The node ID to check
 * @returns True if the node is a trigger node
 */
export function isTriggerNode(nodeId: string): boolean {
  const validTriggerTypes = Object.values(WorkflowTriggerType)
  return validTriggerTypes.includes(nodeId as WorkflowTriggerType)
}

/**
 * Get all trigger node IDs
 * @returns Array of all trigger node IDs
 */
export function getAllTriggerNodeIds(): string[] {
  return Object.values(WorkflowTriggerType)
}

/**
 * Validate that a workflow's trigger type matches its trigger nodes
 * @param workflowTriggerType The workflow's trigger type
 * @param nodeTypes Array of node types in the workflow
 * @returns Validation result with any warnings
 */
export function validateTriggerTypeConsistency(
  workflowTriggerType: WorkflowTriggerType,
  nodeTypes: string[]
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = []
  const expectedNodeId = triggerTypeToNodeIdMapper(workflowTriggerType)

  // Find all trigger nodes in the workflow
  const triggerNodes = nodeTypes.filter((nodeType) => isTriggerNode(nodeType))

  // Check if there are no trigger nodes
  if (triggerNodes.length === 0) {
    warnings.push(`Workflow has trigger type ${workflowTriggerType} but no trigger nodes`)
  }

  // Check if there are multiple trigger nodes
  if (triggerNodes.length > 1) {
    warnings.push(`Workflow has multiple trigger nodes: ${triggerNodes.join(', ')}`)
  }

  // Check if the trigger node matches the workflow trigger type
  if (triggerNodes.length === 1 && triggerNodes[0] !== expectedNodeId) {
    warnings.push(
      `Workflow trigger type ${workflowTriggerType} doesn't match trigger node ${triggerNodes[0]}. Expected ${expectedNodeId}`
    )
  }

  return { isValid: warnings.length === 0, warnings }
}

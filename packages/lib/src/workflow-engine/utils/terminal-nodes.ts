// packages/lib/src/workflow-engine/utils/terminal-nodes.ts

/**
 * Terminal nodes are nodes that can legitimately end a workflow execution path.
 * These nodes either:
 * 1. Produce a final output/response (like answer, http)
 * 2. Perform a final action without requiring further processing (like variable-set, execute)
 * 3. Are explicitly designed to end workflows (like end node)
 * 4. Handle asynchronous operations that don't require immediate continuation (like wait, webhook)
 */

// Set of node types that can be terminal nodes in a workflow
export const TERMINAL_NODE_TYPES = new Set([
  // Flow control nodes
  'end', // Explicitly designed to end workflows

  // Response/Output nodes
  'answer', // Sends a response to the user
  'http', // Makes an HTTP request and can end the flow

  // Action nodes that can be final
  'execute', // Executes an action (like sending email)
  'variable-set', // Sets variables as a final action
  'code', // Executes code that might produce final output
  'crud',
  // Asynchronous/Wait nodes
  'wait', // Waits for a condition/time
  'webhook', // Waits for external webhook call

  // Processing nodes that can produce final results
  'text-classifier', // Classifies text and can be a final result
  'information-extractor', // Extracts information as final output
  'ai', // AI processing that can produce final responses
  'ai-v2', // Enhanced AI processing
])

/**
 * Checks if a given node type can be a terminal node in a workflow
 * @param nodeType - The type of the node to check
 * @returns true if the node can be a terminal node, false otherwise
 */
export function isTerminalNodeType(nodeType: string): boolean {
  return TERMINAL_NODE_TYPES.has(nodeType)
}

/**
 * Validates if a node configuration is appropriate as a terminal node
 * @param nodeType - The type of the node
 * @param hasOutgoingConnections - Whether the node has outgoing connections
 * @returns true if valid as terminal, false otherwise
 */
export function validateTerminalNode(nodeType: string, hasOutgoingConnections: boolean): boolean {
  // If it has outgoing connections, it's not terminal
  if (hasOutgoingConnections) {
    return false
  }

  // Check if the node type can be terminal
  return isTerminalNodeType(nodeType)
}

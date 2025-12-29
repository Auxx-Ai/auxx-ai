// packages/lib/src/workflow-engine/core/single-node-executor.ts

import type { WorkflowNode } from './types'
import type { NodeProcessorRegistry } from './node-processor-registry'
import { ExecutionContextManager } from './execution-context'
import type { Database } from '@auxx/database'

/**
 * Context for single node execution
 */
export interface SingleNodeExecutionContext {
  workflowId: string
  executionId: string
  organizationId: string
  userId: string
  userEmail?: string
  userName?: string
  organizationName?: string
  organizationHandle?: string
}

/**
 * Result from single node execution
 */
export interface SingleNodeExecutionResult {
  outputs: Record<string, any>
  processData: any
}

/**
 * Execute a single workflow node in isolation
 * Useful for testing/debugging individual nodes without full workflow context
 *
 * @param node - The workflow node to execute
 * @param inputs - Input variables for the node
 * @param context - Execution context (user, organization, etc.)
 * @param registry - Node processor registry (must be initialized with initializeWithDefaults)
 * @returns Node execution result with outputs and processData
 *
 * @throws Error if no processor found for node type
 *
 * @example
 * ```typescript
 * const registry = new NodeProcessorRegistry()
 * await registry.initializeWithDefaults()
 *
 * const result = await executeSingleNode(
 *   node,
 *   { input1: 'value1' },
 *   {
 *     workflowId: 'wf-123',
 *     executionId: 'exec-456',
 *     organizationId: 'org-789',
 *     userId: 'user-abc'
 *   },
 *   registry
 * )
 * ```
 */
export async function executeSingleNode(
  node: WorkflowNode,
  inputs: Record<string, any>,
  context: SingleNodeExecutionContext,
  registry: NodeProcessorRegistry,
  workflow?: { envVars?: any[] },
  db?: Database
): Promise<SingleNodeExecutionResult> {
  // 1. Get processor from registry
  const processor = await registry.getProcessor(node.type)
  if (!processor) {
    throw new Error(`No processor found for node type: ${node.type}`)
  }

  // 2. Create execution context manager
  const contextManager = new ExecutionContextManager(
    context.workflowId,
    context.executionId,
    context.organizationId,
    context.userId,
    context.userEmail,
    context.userName,
    context.organizationName,
    context.organizationHandle,
    db
  )

  // 3. Initialize system variables
  contextManager.initializeSystemVariables()

  // 3.5. Initialize environment variables from workflow
  if (workflow?.envVars) {
    contextManager.initializeEnvironmentVariables(workflow.envVars)
  }

  // 3.6. Set minimal workflow context for AI nodes (testing/debugging)
  contextManager.setVariable('sys.workflow', {
    id: context.workflowId,
    name: 'Test Workflow',
    workflowId: context.workflowId,
  })

  // 4. Set input variables
  Object.entries(inputs).forEach(([key, value]) => {
    contextManager.setVariable(key, value)
  })

  // 5. Preprocess node (required for CRUD and other nodes that need field transformation)
  let preprocessedData: any
  try {
    preprocessedData = await processor.preprocessNode(node, contextManager)
  } catch (error) {
    throw new Error(
      `Failed to preprocess node: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // 6. Execute the node with preprocessed data
  const result = await processor.execute(node, contextManager, preprocessedData)

  // 7. Return formatted result
  return {
    outputs: result.output || {},
    processData: result.processData || null,
  }
}

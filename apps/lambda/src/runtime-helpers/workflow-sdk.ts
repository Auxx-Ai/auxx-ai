// apps/lambda/src/runtime-helpers/workflow-sdk.ts

/**
 * Workflow SDK implementation for Lambda runtime
 * Extends the Server SDK with workflow-specific methods
 */

import type { WorkflowExecutionContext, WorkflowSDK } from '../types/workflow.ts'
import { createServerSDK } from './index.ts'

/**
 * Inject Workflow SDK into global scope
 * Called before executing workflow block
 */
export function injectWorkflowSDK(context: WorkflowExecutionContext): void {
  console.log('[WorkflowSDK] Injecting workflow SDK')

  // Create base Server SDK
  const serverSDK = createServerSDK(context)

  // Create Workflow SDK (extends Server SDK)
  const workflowSDK: WorkflowSDK = {
    // Inherit all Server SDK methods
    ...serverSDK,

    // Workflow-specific methods
    getVariable: (name: string) => {
      console.log('[WorkflowSDK] getVariable:', name)
      // Support dot notation: "message.subject", "node_123.result", "env.apiKey"
      return getNestedValue(context.variables, name)
    },

    setVariable: (name: string, value: any) => {
      console.log('[WorkflowSDK] setVariable:', name, value)
      context.variables[name] = value
    },

    // v2: Enhanced variable access methods
    getEnvironmentVariable: (name: string) => {
      console.log('[WorkflowSDK] getEnvironmentVariable:', name)
      return context.environmentVariables?.[name]
    },

    getSystemVariable: (name: string) => {
      console.log('[WorkflowSDK] getSystemVariable:', name)
      return context.systemVariables?.[name]
    },

    getTriggerData: () => {
      console.log('[WorkflowSDK] getTriggerData')
      return context.triggerData
    },

    // v2: Access specific field from previous node's output
    getNodeOutput: (nodeId: string, fieldName: string) => {
      console.log('[WorkflowSDK] getNodeOutput:', nodeId, fieldName)
      const outputs = context.nodeOutputs?.[nodeId]
      return outputs?.[fieldName]
    },

    // v2: Access entire output object from previous node
    getNodeOutputs: (nodeId: string) => {
      console.log('[WorkflowSDK] getNodeOutputs:', nodeId)
      return context.nodeOutputs?.[nodeId]
    },

    log: (level, message, data) => {
      // Log to console - will be captured by console interceptor from runtime-helpers
      console[level === 'info' ? 'log' : level](message, data)
    },

    // Cache methods (optional)
    cache: context.cache
      ? {
          get: async (key: string) => {
            console.log('[WorkflowSDK] cache.get:', key)
            return await context.cache!.get(`${context.executionId}:${key}`)
          },

          set: async (key: string, value: any, ttl?: number) => {
            console.log('[WorkflowSDK] cache.set:', key, ttl)
            await context.cache!.set(`${context.executionId}:${key}`, value, ttl)
          },

          delete: async (key: string) => {
            console.log('[WorkflowSDK] cache.delete:', key)
            await context.cache!.delete(`${context.executionId}:${key}`)
          },
        }
      : undefined,
  }

  /**
   * Get nested value from object using dot notation
   */
  function getNestedValue(obj: any, path: string): any {
    const keys = path.split('.')
    let value = obj
    for (const key of keys) {
      value = value?.[key]
      if (value === undefined) break
    }
    return value
  }

  // Inject into global scope
  const g = globalThis as typeof globalThis & { __AUXX_WORKFLOW_SDK__: WorkflowSDK }
  g.__AUXX_WORKFLOW_SDK__ = workflowSDK
}

/**
 * Clean up Workflow SDK from global scope
 */
export function cleanupWorkflowSDK(): void {
  console.log('[WorkflowSDK] Cleaning up workflow SDK')
  const g = globalThis as typeof globalThis & { __AUXX_WORKFLOW_SDK__?: WorkflowSDK }
  delete g.__AUXX_WORKFLOW_SDK__
}

/**
 * Create workflow execution context from Lambda event and runtime context
 */
export function createWorkflowExecutionContext(
  workflowContext: {
    workflowId: string
    executionId: string
    nodeId: string
    variables: Record<string, any>
    environmentVariables?: Record<string, any>
    systemVariables?: Record<string, any>
    triggerData?: Record<string, any>
    nodeOutputs?: Record<string, Record<string, any>>
    user: {
      id: string
      email?: string | null
      name: string
    }
    organization: {
      id: string
      handle: string
      name: string
    }
  },
  runtimeContext: any
): WorkflowExecutionContext {
  return {
    ...runtimeContext,
    workflowId: workflowContext.workflowId,
    executionId: workflowContext.executionId,
    nodeId: workflowContext.nodeId,
    variables: workflowContext.variables,
    // v2: Enhanced context
    environmentVariables: workflowContext.environmentVariables,
    systemVariables: workflowContext.systemVariables,
    triggerData: workflowContext.triggerData,
    nodeOutputs: workflowContext.nodeOutputs,
    // Cache would be injected here if available
    cache: undefined,
  }
}

// apps/lambda/src/runtime-helpers/workflow-sdk.ts

/**
 * Workflow SDK implementation for Lambda runtime
 * Extends the Server SDK with workflow-specific methods
 */

import type { WorkflowExecutionContext, WorkflowSDK } from '../types/workflow.ts'
import { createServerSDK } from './index.ts'

/**
 * Minimal local mirror of `@auxx/sdk`'s `BlockRuntimeError`.
 *
 * The lambda executors detect runtime errors across the sandbox / module
 * boundary by `error.name === 'BlockRuntimeError'`, not `instanceof`.
 * Defining a local class (lambda has no `@auxx/sdk` runtime dep) lets a
 * missing tool lookup surface as a structured runtime error instead of a
 * 500.
 */
class BlockRuntimeError extends Error {
  readonly code: string
  constructor(message: string, code = 'BLOCK_RUNTIME_ERROR') {
    super(message)
    this.name = 'BlockRuntimeError'
    this.code = code
  }
}

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

    /**
     * In-process dispatch into the bundle's `__AUXX_TOOLS__` registry.
     *
     * Used by router-style workflow blocks (impl plan §6.3 / §7.4) — the
     * block's execute resolves a tool id from its baked `toolMap` and
     * forwards inputs through this helper. Looks up the tool by id and
     * invokes its execute inside the same workflow sandbox. Throws
     * `BlockRuntimeError` (name-matched by the executor) on missing id.
     */
    runTool: async (toolId: string, input: Record<string, any>) => {
      console.log('[WorkflowSDK] runTool:', toolId)
      const g = globalThis as typeof globalThis & {
        __AUXX_TOOLS__?: Record<string, { execute: (input: any, ctx?: any) => unknown }>
      }
      const tool = g.__AUXX_TOOLS__?.[toolId]
      if (!tool) {
        throw new BlockRuntimeError(`Tool not found: ${toolId}`)
      }
      if (typeof tool.execute !== 'function') {
        throw new BlockRuntimeError(`Tool ${toolId} does not have an execute function`)
      }
      return await tool.execute(input, context)
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

/** Shape of the bundle's `__AUXX_TOOLS__` registry, keyed by tool id. */
type ToolRegistry = Record<string, { execute: (input: any, ctx?: any) => unknown }>

/**
 * Expose the bundle's tool registry on `globalThis.__AUXX_TOOLS__`.
 *
 * Router-style workflow blocks dispatch to internal tools via `ctx.runTool`,
 * which resolves the tool off `globalThis.__AUXX_TOOLS__` (see `runTool` above).
 * The generated bundle keeps `__AUXX_TOOLS__` as a function-local const, so the
 * executor must lift it onto the global after running the bundle and before
 * invoking the block — mirroring the `__AUXX_WORKFLOW_SDK__` inject/cleanup
 * lifecycle. Always pair with `clearToolRegistry()` in a `finally`.
 */
export function setToolRegistry(tools: ToolRegistry | undefined): void {
  const g = globalThis as typeof globalThis & { __AUXX_TOOLS__?: ToolRegistry }
  g.__AUXX_TOOLS__ = tools ?? {}
}

/** Remove the tool registry from global scope. */
export function clearToolRegistry(): void {
  const g = globalThis as typeof globalThis & { __AUXX_TOOLS__?: ToolRegistry }
  delete g.__AUXX_TOOLS__
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

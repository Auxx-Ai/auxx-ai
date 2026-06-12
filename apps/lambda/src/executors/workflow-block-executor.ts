// apps/lambda/src/executors/workflow-block-executor.ts

/**
 * Workflow block executor for Lambda runtime
 * Executes workflow blocks in a sandboxed environment with the Workflow SDK
 */

import {
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import {
  cleanupWorkflowSDK,
  clearToolRegistry,
  createWorkflowExecutionContext,
  injectWorkflowSDK,
  setToolRegistry,
} from '../runtime-helpers/workflow-sdk.ts'
import type {
  // WorkflowExecutionInput,
  // WorkflowExecutionOutput,
  WorkflowExecutionContext,
} from '../types/workflow.ts'
import type { ExecutionResult } from '../types.ts'
import { parseError } from '../utils.ts'
import type { WorkflowBlockExecutionEvent } from '../validator.ts'

/**
 * Execute a workflow block
 * Uses WorkflowBlockExecutionEvent type from validator for type safety
 */
export async function executeWorkflowBlock(
  options: Omit<WorkflowBlockExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: any
  }
): Promise<ExecutionResult> {
  const {
    bundleCode,
    blockId,
    workflowContext,
    workflowInput,
    context,
    timeout, // Default provided by Zod schema
  } = options

  console.log('[WorkflowBlockExecutor] Starting execution:', { blockId })

  // Create workflow execution context
  const executionContext = createWorkflowExecutionContext(workflowContext, context)

  // Execute with timeout
  const executionPromise = executeInSandbox(bundleCode, blockId, workflowInput, executionContext)

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Workflow block execution timeout after ${timeout}ms`)),
      timeout
    )
  })

  try {
    const result = await Promise.race([executionPromise, timeoutPromise])
    console.log('[WorkflowBlockExecutor] Execution complete:', { blockId })
    return result
  } finally {
    // Clear the timeout timer so it doesn't leak past a fast execution.
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * Execute workflow block in sandbox
 */
async function executeInSandbox(
  bundleCode: string,
  blockId: string,
  workflowInput: Record<string, any>,
  context: WorkflowExecutionContext
): Promise<ExecutionResult> {
  try {
    // 1. Inject Server Runtime Helpers (for base SDK)
    injectServerRuntimeHelpers(context)

    // 2. Inject Workflow SDK (extends Server SDK)
    injectWorkflowSDK(context)

    // 3. Execute bundle to register workflow blocks and the tool registry.
    // Both are function-local consts in the bundle; we lift them out via the
    // appended return. `__AUXX_TOOLS__` must reach `globalThis` so router-style
    // blocks can dispatch to internal tools via `ctx.runTool` (which resolves
    // off `globalThis.__AUXX_TOOLS__`). Cleared in the `finally` below.
    const codeWithReturn = bundleCode + '\nreturn { __AUXX_WORKFLOW_BLOCKS__, __AUXX_TOOLS__ };'
    const fn = new Function(codeWithReturn)
    const result = fn()
    const workflowBlocks = result.__AUXX_WORKFLOW_BLOCKS__

    if (!workflowBlocks) {
      throw new Error('Server bundle does not export workflow blocks')
    }

    setToolRegistry(result.__AUXX_TOOLS__)

    // 4. Get the specific workflow block
    const workflowBlock = workflowBlocks[blockId]

    if (!workflowBlock) {
      throw new Error(`Workflow block not found: ${blockId}`)
    }

    if (typeof workflowBlock.execute !== 'function') {
      throw new Error(`Workflow block ${blockId} does not have an execute function`)
    }

    // 5. Prepare execution input
    // TODO: Remove executionInput once all workflow blocks are updated to use direct SDK imports
    // const executionInput: WorkflowExecutionInput = {
    //   data: workflowInput,
    //   context: {
    //     workflowId: context.workflowId,
    //     executionId: context.executionId,
    //     nodeId: context.nodeId,
    //     variables: context.variables,
    //     user: {
    //       id: context.user.id,
    //       email: context.user.email,
    //       name: context.user.email.split('@')[0], // TODO: Get real name
    //     },
    //     organization: {
    //       id: context.organization.id,
    //       handle: context.organization.handle,
    //       name: context.organization.handle, // TODO: Get real name
    //     },
    //   },
    //   // SDK is available globally as __AUXX_WORKFLOW_SDK__
    //   sdk: (globalThis as any).__AUXX_WORKFLOW_SDK__,
    // }

    // 6. Execute the workflow block
    // Pass a thin `ctx` second arg exposing `runTool` so router-style blocks
    // (impl plan §6.3) can do `ctx.runTool(toolId, input)` to dispatch into
    // __AUXX_TOOLS__ inside the same sandbox. The same helper is also
    // reachable via `globalThis.__AUXX_WORKFLOW_SDK__.runTool`; both paths
    // share one implementation in `runtime-helpers/workflow-sdk.ts`.
    const sdk = (globalThis as any).__AUXX_WORKFLOW_SDK__
    const blockCtx = { runTool: sdk.runTool }
    console.log('[WorkflowBlockExecutor] Executing workflow block:', blockId)
    const output = await workflowBlock.execute(workflowInput, blockCtx)

    // 7. Get captured logs from console interception
    const consoleLogs = getCapturedLogs()

    // 8. Return result with ExecutionResult structure (matching other executors)
    return {
      result: output, // Workflow blocks return flat output objects (InferWorkflowOutput type)
      metadata: {
        consoleLogs, // Map 'logs' to 'consoleLogs'
      },
    }
  } catch (error: unknown) {
    // Capture logs even on error
    const consoleLogs = getCapturedLogs()

    const { message } = parseError(error)
    console.error('[WorkflowBlockExecutor] Execution failed:', message)

    // Include logs in error for debugging
    if (consoleLogs.length > 0) {
      console.error('[WorkflowBlockExecutor] Logs captured before error:')
      consoleLogs.forEach((log) => {
        console.error(`  [${log.level}] ${log.message}`)
      })
    }

    // BlockValidationError — return a structured result instead of a 500 so the
    // platform can surface per-field messages in the workflow panel UI.
    if (error instanceof Error && error.name === 'BlockValidationError') {
      return {
        result: null,
        metadata: {
          consoleLogs,
          validationError: {
            fields: (error as any).fields as Array<{ field: string; message: string }>,
            message: error.message,
          },
        },
      }
    }

    // BlockRuntimeError — return as structured metadata (HTTP 200) so console logs
    // flow back intact and the platform can show "app error" instead of "platform crash".
    if (error instanceof Error && error.name === 'BlockRuntimeError') {
      return {
        result: null,
        metadata: {
          consoleLogs,
          runtimeError: {
            message: error.message,
            code: (error as any).code,
          },
        },
      }
    }

    throw error
  } finally {
    // 9. Clean up
    clearToolRegistry()
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
  }
}

// apps/lambda/src/executors/ai-tool-executor.ts

/**
 * AI tool executor for the Lambda runtime.
 *
 * Loads the bundled app's `__AUXX_AI_TOOLS__` registry, looks up the requested
 * tool by id, and calls `tool.execute(input, ctx)` with the Workflow SDK
 * injected — same shape as workflow blocks. The result flows back through
 * `invokeLambdaExecutor` on the caller side.
 *
 * Pattern-matched against `workflow-block-executor.ts`. See plans/kopilot/apps/README.md §6.1
 * and plans/kopilot/agents/tool-loading-and-execution.md §6 (decision E1).
 */

import {
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import {
  cleanupWorkflowSDK,
  createWorkflowExecutionContext,
  injectWorkflowSDK,
} from '../runtime-helpers/workflow-sdk.ts'
import type { ExecutionResult } from '../types.ts'
import { parseError } from '../utils.ts'
import type { AiToolExecutionEvent } from '../validator.ts'

export async function executeAiTool(
  options: Omit<AiToolExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    // `context` here is the runtime context produced by createRuntimeContext;
    // the executor doesn't introspect it directly — it's injected into the SDK.
    context: any
  }
): Promise<ExecutionResult> {
  const { bundleCode, toolId, toolInput, context, timeout, kopilotContext } = options

  console.log('[AiToolExecutor] Starting execution:', { toolId })

  const executionContext = createWorkflowExecutionContext(
    {
      workflowId: 'kopilot',
      executionId: kopilotContext?.sessionId ?? 'ai-tool',
      nodeId: toolId,
      variables: {},
      user: {
        id: context.userId ?? 'system',
        email: context.userEmail ?? '',
        name: context.userName ?? '',
      },
      organization: {
        id: context.organizationId,
        handle: context.organizationHandle,
        name: context.organizationHandle,
      },
    },
    context
  )

  const executionPromise = executeInSandbox(bundleCode, toolId, toolInput, executionContext)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`AI tool execution timeout after ${timeout}ms`)), timeout)
  })
  const result = await Promise.race([executionPromise, timeoutPromise])
  console.log('[AiToolExecutor] Execution complete:', { toolId })
  return result
}

async function executeInSandbox(
  bundleCode: string,
  toolId: string,
  toolInput: Record<string, unknown>,
  context: any
): Promise<ExecutionResult> {
  try {
    injectServerRuntimeHelpers(context)
    injectWorkflowSDK(context)

    // Mirrors workflow-block-executor — append `return { __AUXX_AI_TOOLS__ }`
    // so we extract the registry from the bundle's top-level scope.
    const codeWithReturn = bundleCode + '\nreturn { __AUXX_AI_TOOLS__ };'
    const fn = new Function(codeWithReturn)
    const result = fn()
    const aiTools = result.__AUXX_AI_TOOLS__

    if (!aiTools) {
      throw new Error('Server bundle does not export AI tools (__AUXX_AI_TOOLS__)')
    }

    const tool = aiTools[toolId]
    if (!tool) {
      throw new Error(`AI tool not found: ${toolId}`)
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`AI tool ${toolId} does not have an execute function`)
    }

    console.log('[AiToolExecutor] Executing AI tool:', toolId)
    // Tool authors define `execute(input, ctx)`. The ctx surface includes
    // `entities.findByIntegrationId` etc. via the SDK injection — the helper
    // forwards to the API route using the entities callback token.
    const output = await tool.execute(toolInput)

    const consoleLogs = getCapturedLogs()
    return {
      result: output,
      metadata: { consoleLogs },
    }
  } catch (error: unknown) {
    const consoleLogs = getCapturedLogs()
    const { message } = parseError(error)
    console.error('[AiToolExecutor] Execution failed:', message)

    if (consoleLogs.length > 0) {
      console.error('[AiToolExecutor] Logs captured before error:')
      consoleLogs.forEach((log) => {
        console.error(`  [${log.level}] ${log.message}`)
      })
    }

    // Preserve the typed error envelope `invokeLambdaExecutor` already maps
    // to CONNECTION_REQUIRED. See plans/kopilot/apps/credentials.md §3.5.
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
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
  }
}

// apps/lambda/src/executors/ai-tool-executor.ts

/**
 * AI tool executor for the Lambda runtime.
 *
 * Loads the bundled app's `__AUXX_AI_TOOLS__` registry, looks up the requested
 * tool by id, and calls `tool.execute(input, ctx)` with the Workflow SDK
 * injected — same shape as workflow blocks. The result flows back through
 * `invokeLambdaExecutor` (buffered) or `invokeLambdaExecutorStreaming` on the
 * caller side.
 *
 * Two entry points:
 *   - `executeAiTool` — buffered: awaits a single value (or drains a streaming
 *     tool's generator and returns its final value).
 *   - `executeAiToolStreaming` — async generator: yields one envelope per
 *     progress event from a streaming tool, then returns the final result.
 *
 * Pattern-matched against `workflow-block-executor.ts`. See plans/kopilot/apps/README.md §6
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

/** A streaming tool's progress payload — passed through verbatim to the caller. */
export interface AiToolStreamProgress {
  kind?: string
  data: unknown
}

type SetupResult = {
  tool: { execute: (input: Record<string, unknown>) => unknown }
  cleanup: () => void
}

function setupSandbox(
  bundleCode: string,
  toolId: string,
  context: unknown,
  kopilotContext: AiToolExecutionEvent['kopilotContext']
): SetupResult {
  const ctx = context as {
    userId?: string
    userEmail?: string
    userName?: string
    organizationId: string
    organizationHandle: string
  }
  const executionContext = createWorkflowExecutionContext(
    {
      workflowId: 'kopilot',
      executionId: kopilotContext?.sessionId ?? 'ai-tool',
      nodeId: toolId,
      variables: {},
      user: {
        id: ctx.userId ?? 'system',
        email: ctx.userEmail ?? '',
        name: ctx.userName ?? '',
      },
      organization: {
        id: ctx.organizationId,
        handle: ctx.organizationHandle,
        name: ctx.organizationHandle,
      },
    },
    context
  )

  injectServerRuntimeHelpers(executionContext)
  injectWorkflowSDK(executionContext)

  // Mirrors workflow-block-executor — append `return { __AUXX_AI_TOOLS__ }`
  // so we extract the registry from the bundle's top-level scope.
  const codeWithReturn = bundleCode + '\nreturn { __AUXX_AI_TOOLS__ };'
  const fn = new Function(codeWithReturn)
  const result = fn()
  const aiTools = result.__AUXX_AI_TOOLS__

  if (!aiTools) {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error('Server bundle does not export AI tools (__AUXX_AI_TOOLS__)')
  }

  const tool = aiTools[toolId]
  if (!tool) {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error(`AI tool not found: ${toolId}`)
  }
  if (typeof tool.execute !== 'function') {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error(`AI tool ${toolId} does not have an execute function`)
  }

  return {
    tool,
    cleanup: () => {
      cleanupWorkflowSDK()
      cleanupServerRuntimeHelpers()
    },
  }
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (value === null || typeof value !== 'object') return false
  const v = value as { next?: unknown; [Symbol.asyncIterator]?: unknown }
  return typeof v.next === 'function' && typeof v[Symbol.asyncIterator] === 'function'
}

function buildRuntimeErrorResult(error: unknown, consoleLogs: ReturnType<typeof getCapturedLogs>) {
  // Preserve the typed error envelope `invokeLambdaExecutor` already maps
  // to CONNECTION_REQUIRED. See plans/kopilot/apps/credentials.md §3.5.
  if (error instanceof Error && error.name === 'BlockRuntimeError') {
    return {
      result: null,
      metadata: {
        consoleLogs,
        runtimeError: {
          message: error.message,
          code: (error as { code?: string }).code,
        },
      },
    } satisfies ExecutionResult
  }
  return null
}

export async function executeAiTool(
  options: Omit<AiToolExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: unknown
  }
): Promise<ExecutionResult> {
  const { bundleCode, toolId, toolInput, context, timeout, kopilotContext } = options

  console.log('[AiToolExecutor] Starting execution:', { toolId })

  const setup = setupSandbox(bundleCode, toolId, context, kopilotContext)

  const executionPromise = (async (): Promise<ExecutionResult> => {
    try {
      const exec = setup.tool.execute(toolInput)
      let output: unknown
      if (isAsyncGenerator(exec)) {
        // Buffered path consuming a streaming tool — drain the generator,
        // discarding progress, and return the final value.
        while (true) {
          const next = await exec.next()
          if (next.done) {
            output = next.value
            break
          }
        }
      } else {
        output = await exec
      }
      const consoleLogs = getCapturedLogs()
      return { result: output, metadata: { consoleLogs } }
    } catch (error) {
      const consoleLogs = getCapturedLogs()
      const { message } = parseError(error)
      console.error('[AiToolExecutor] Execution failed:', message)
      const runtime = buildRuntimeErrorResult(error, consoleLogs)
      if (runtime) return runtime
      throw error
    } finally {
      setup.cleanup()
    }
  })()

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`AI tool execution timeout after ${timeout}ms`)), timeout)
  })
  const result = await Promise.race([executionPromise, timeoutPromise])
  console.log('[AiToolExecutor] Execution complete:', { toolId })
  return result
}

/**
 * Streaming variant — yields each progress event from a streaming tool's
 * generator, then returns the final `ExecutionResult`. Buffered tools work
 * here too: the generator simply yields nothing and returns the final value
 * once. Caller (`POST /ai-tool/stream`) is responsible for translating yields
 * into SSE frames and the return value into the terminal `event: result`.
 */
export async function* executeAiToolStreaming(
  options: Omit<AiToolExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: unknown
  }
): AsyncGenerator<AiToolStreamProgress, ExecutionResult, void> {
  const { bundleCode, toolId, toolInput, context, timeout, kopilotContext } = options

  console.log('[AiToolExecutor:stream] Starting execution:', { toolId })

  const setup = setupSandbox(bundleCode, toolId, context, kopilotContext)
  const startedAt = Date.now()

  try {
    const exec = setup.tool.execute(toolInput)
    let output: unknown
    if (isAsyncGenerator(exec)) {
      while (true) {
        if (Date.now() - startedAt > timeout) {
          throw new Error(`AI tool execution timeout after ${timeout}ms`)
        }
        const next = await exec.next()
        if (next.done) {
          output = next.value
          break
        }
        const payload = next.value as AiToolStreamProgress | unknown
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in (payload as Record<string, unknown>)
        ) {
          yield payload as AiToolStreamProgress
        } else {
          yield { data: payload }
        }
      }
    } else {
      // Buffered tool invoked through the streaming endpoint — race against
      // the timeout, then return without ever yielding a progress event.
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`AI tool execution timeout after ${timeout}ms`)), timeout)
      })
      output = await Promise.race([exec as Promise<unknown>, timeoutPromise])
    }
    const consoleLogs = getCapturedLogs()
    console.log('[AiToolExecutor:stream] Execution complete:', { toolId })
    return { result: output, metadata: { consoleLogs } } satisfies ExecutionResult
  } catch (error) {
    const consoleLogs = getCapturedLogs()
    const { message } = parseError(error)
    console.error('[AiToolExecutor:stream] Execution failed:', message)
    const runtime = buildRuntimeErrorResult(error, consoleLogs)
    if (runtime) return runtime
    throw error
  } finally {
    setup.cleanup()
  }
}

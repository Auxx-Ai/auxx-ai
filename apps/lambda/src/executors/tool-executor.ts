// apps/lambda/src/executors/tool-executor.ts

/**
 * Unified tool executor for the Lambda runtime.
 *
 * Loads the bundled app's `__AUXX_TOOLS__` registry, looks up the requested
 * tool by id, and calls `tool.execute(input, ctx)` with the Workflow SDK
 * injected — same sandbox shape as workflow blocks.
 *
 * The executor discriminates on `invocationContext.kind`:
 *   - 'agent'  — LLM-driven invocation (Kopilot bridge caller).
 *   - 'action' — quick-action button invocation (ticket / email editor).
 *
 * Two entry points (buffered + streaming) mirror `ai-tool-executor.ts`.
 *
 * Replaces `ai-tool-executor.ts` and `quick-action-executor.ts` once callers
 * migrate (T7/T8). Old files stay in place until T12 strips them.
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
import type { ToolExecutionEvent, ToolInvocationContext } from '../validator.ts'

/** A streaming tool's progress payload — passed through verbatim to the caller. */
export interface ToolStreamProgress {
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
  invocationContext: ToolInvocationContext | null | undefined
): SetupResult {
  const ctx = context as {
    userId?: string
    userEmail?: string
    userName?: string
    organizationId: string
    organizationHandle: string
  }

  // Reuse the workflow execution context shape; nodeId carries the tool id,
  // executionId carries an invocation marker (kopilot session, ticket thread,
  // or `tool` when neither surface supplies one).
  const executionId =
    invocationContext?.kind === 'agent'
      ? (invocationContext.sessionId ?? 'agent')
      : invocationContext?.kind === 'action'
        ? (invocationContext.threadId ?? 'action')
        : 'tool'

  const executionContext = createWorkflowExecutionContext(
    {
      workflowId: invocationContext?.kind === 'agent' ? 'kopilot' : 'quick-action',
      executionId,
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

  // Mirrors workflow-block-executor — append `return { __AUXX_TOOLS__ }`
  // so we extract the registry from the bundle's top-level scope.
  const codeWithReturn = bundleCode + '\nreturn { __AUXX_TOOLS__ };'
  const fn = new Function(codeWithReturn)
  const result = fn()
  const tools = result.__AUXX_TOOLS__

  if (!tools) {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error('Server bundle does not export tools (__AUXX_TOOLS__)')
  }

  const tool = tools[toolId]
  if (!tool) {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error(`Tool not found: ${toolId}`)
  }
  if (typeof tool.execute !== 'function') {
    cleanupWorkflowSDK()
    cleanupServerRuntimeHelpers()
    throw new Error(`Tool ${toolId} does not have an execute function`)
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

export async function executeTool(
  options: Omit<ToolExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: unknown
  }
): Promise<ExecutionResult> {
  const { bundleCode, toolId, inputs, context, timeout, invocationContext } = options

  console.log('[ToolExecutor] Starting execution:', {
    toolId,
    kind: invocationContext?.kind ?? 'none',
  })

  const setup = setupSandbox(bundleCode, toolId, context, invocationContext)

  const executionPromise = (async (): Promise<ExecutionResult> => {
    try {
      const exec = setup.tool.execute(inputs)
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
      console.error('[ToolExecutor] Execution failed:', message)
      const runtime = buildRuntimeErrorResult(error, consoleLogs)
      if (runtime) return runtime
      throw error
    } finally {
      setup.cleanup()
    }
  })()

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
  })
  const result = await Promise.race([executionPromise, timeoutPromise])
  console.log('[ToolExecutor] Execution complete:', { toolId })
  return result
}

/**
 * Streaming variant — yields each progress event from a streaming tool's
 * generator, then returns the final `ExecutionResult`. Buffered tools work
 * here too: the generator simply yields nothing and returns the final value
 * once. Caller is responsible for translating yields into SSE frames and the
 * return value into the terminal `event: result`.
 */
export async function* executeToolStreaming(
  options: Omit<ToolExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: unknown
  }
): AsyncGenerator<ToolStreamProgress, ExecutionResult, void> {
  const { bundleCode, toolId, inputs, context, timeout, invocationContext } = options

  console.log('[ToolExecutor:stream] Starting execution:', {
    toolId,
    kind: invocationContext?.kind ?? 'none',
  })

  const setup = setupSandbox(bundleCode, toolId, context, invocationContext)
  const startedAt = Date.now()

  try {
    const exec = setup.tool.execute(inputs)
    let output: unknown
    if (isAsyncGenerator(exec)) {
      while (true) {
        if (Date.now() - startedAt > timeout) {
          throw new Error(`Tool execution timeout after ${timeout}ms`)
        }
        const next = await exec.next()
        if (next.done) {
          output = next.value
          break
        }
        const payload = next.value as ToolStreamProgress | unknown
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in (payload as Record<string, unknown>)
        ) {
          yield payload as ToolStreamProgress
        } else {
          yield { data: payload }
        }
      }
    } else {
      // Buffered tool invoked through the streaming endpoint — race against
      // the timeout, then return without ever yielding a progress event.
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
      })
      output = await Promise.race([exec as Promise<unknown>, timeoutPromise])
    }
    const consoleLogs = getCapturedLogs()
    console.log('[ToolExecutor:stream] Execution complete:', { toolId })
    return { result: output, metadata: { consoleLogs } } satisfies ExecutionResult
  } catch (error) {
    const consoleLogs = getCapturedLogs()
    const { message } = parseError(error)
    console.error('[ToolExecutor:stream] Execution failed:', message)
    const runtime = buildRuntimeErrorResult(error, consoleLogs)
    if (runtime) return runtime
    throw error
  } finally {
    setup.cleanup()
  }
}

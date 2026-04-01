// apps/lambda/src/executors/quick-action-executor.ts

/**
 * Quick action executor for Lambda runtime.
 * Executes quick actions in a sandboxed environment with the Server SDK.
 */

import {
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import type { ExecutionResult } from '../types.ts'
import { parseError } from '../utils.ts'
import type { QuickActionExecutionEvent } from '../validator.ts'

/**
 * Execute a quick action with timeout.
 */
export async function executeQuickAction(
  options: Omit<QuickActionExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: any
  }
): Promise<ExecutionResult> {
  const { bundleCode, actionId, inputs, context, timeout } = options

  console.log('[QuickActionExecutor] Starting execution:', { actionId })

  const executionPromise = executeInSandbox(bundleCode, actionId, inputs, context)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Quick action timeout after ${timeout}ms`)), timeout)
  })

  const result = await Promise.race([executionPromise, timeoutPromise])

  console.log('[QuickActionExecutor] Execution complete:', { actionId })

  return result
}

/**
 * Execute quick action in sandbox.
 */
async function executeInSandbox(
  bundleCode: string,
  actionId: string,
  inputs: Record<string, unknown>,
  context: any
): Promise<ExecutionResult> {
  try {
    // 1. Inject Server Runtime Helpers (for base SDK)
    injectServerRuntimeHelpers(context)

    // 2. Execute bundle to register quick actions
    const codeWithReturn = bundleCode + '\nreturn { __AUXX_QUICK_ACTIONS__ };'
    const fn = new Function(codeWithReturn)
    const result = fn()
    const quickActions = result.__AUXX_QUICK_ACTIONS__

    if (!quickActions) {
      throw new Error('Server bundle does not export quick actions')
    }

    // 3. Get the specific quick action
    const action = quickActions[actionId]
    if (!action) {
      throw new Error(`Quick action not found: ${actionId}`)
    }
    if (typeof action.execute !== 'function') {
      throw new Error(`Quick action ${actionId} does not have an execute function`)
    }

    // 4. Execute — only receives inputs (context available via global.AUXX_SERVER_SDK)
    console.log('[QuickActionExecutor] Executing:', actionId)
    const output = await action.execute(inputs)

    // 5. Return result
    const consoleLogs = getCapturedLogs()
    return {
      result: output,
      metadata: { consoleLogs },
    }
  } catch (error: unknown) {
    const consoleLogs = getCapturedLogs()
    const { message } = parseError(error)
    console.error('[QuickActionExecutor] Failed:', message)

    if (consoleLogs.length > 0) {
      console.error('[QuickActionExecutor] Logs captured before error:')
      consoleLogs.forEach((log) => {
        console.error(`  [${log.level}] ${log.message}`)
      })
    }

    // Surface runtime errors as structured metadata (same as workflow-block-executor)
    if (error instanceof Error && error.name === 'BlockRuntimeError') {
      return {
        result: null,
        metadata: {
          consoleLogs,
          runtimeError: { message: error.message, code: (error as any).code },
        },
      }
    }

    throw error
  } finally {
    cleanupServerRuntimeHelpers()
  }
}

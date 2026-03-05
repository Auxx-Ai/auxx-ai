// apps/lambda/src/executors/polling-trigger-executor.ts

import {
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import type { ExecutionResult } from '../types.ts'
import { parseError } from '../utils.ts'
import type { PollingTriggerExecutionEvent } from '../validator.ts'

/**
 * Execute a polling trigger's execute function.
 * Calls execute(input, { state, connection }) and returns { events, state }.
 */
export async function executePollingTrigger(
  options: Omit<PollingTriggerExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: any
  }
): Promise<ExecutionResult> {
  const { bundleCode, triggerId, triggerInput, pollingState, context, timeout } = options

  console.log('[PollingTriggerExecutor] Starting execution:', { triggerId })

  injectServerRuntimeHelpers(context)

  try {
    // Execute bundle to register workflow blocks
    const codeWithReturn = bundleCode + '\nreturn { __AUXX_WORKFLOW_BLOCKS__ };'
    const fn = new Function(codeWithReturn)
    const result = fn()
    const workflowBlocks = result.__AUXX_WORKFLOW_BLOCKS__

    if (!workflowBlocks) {
      throw new Error('Server bundle does not export workflow blocks')
    }

    const trigger = workflowBlocks[triggerId]
    if (!trigger) {
      throw new Error(`Polling trigger not found: ${triggerId}`)
    }
    if (typeof trigger.execute !== 'function') {
      throw new Error(`Polling trigger ${triggerId} does not have an execute function`)
    }

    // Build polling context from the connection already resolved into the runtime context
    const connection = context.organizationConnection
      ? {
          value: context.organizationConnection.value,
          metadata: context.organizationConnection.metadata,
        }
      : null

    const pollingContext = { state: pollingState, connection }

    // Execute with timeout
    const execPromise = trigger.execute(triggerInput, pollingContext)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Poll function timed out after ${timeout}ms`)), timeout)
    )

    const pollResult = await Promise.race([execPromise, timeoutPromise])
    const consoleLogs = getCapturedLogs()

    console.log('[PollingTriggerExecutor] Execution complete:', {
      triggerId,
      eventCount: pollResult?.events?.length ?? 0,
    })

    return {
      result: {
        events: pollResult?.events ?? [],
        state: pollResult?.state ?? {},
      },
      metadata: { consoleLogs },
    }
  } catch (error: unknown) {
    getCapturedLogs() // Drain captured logs before re-throwing
    const { message } = parseError(error)
    console.error('[PollingTriggerExecutor] Execution failed:', message)

    throw error
  } finally {
    cleanupServerRuntimeHelpers()
  }
}

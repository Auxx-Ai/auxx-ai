// apps/lambda/src/executors/event-executor.ts

/**
 * Event handler executor for Lambda runtime.
 * Executes app event handlers in a Deno sandbox.
 */

import {
  type ConsoleLog,
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  getRegisteredSettingsSchema,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import type { ExecutionResult, RuntimeContext } from '../types.ts'
import type { EventExecutionEvent } from '../validator.ts'

/**
 * Execute event handler
 * Uses EventExecutionEvent type from validator for type safety
 */
export async function executeEventHandler(
  options: Omit<EventExecutionEvent, 'context' | 'bundleKey'> & {
    bundleCode: string
    context: RuntimeContext
  }
): Promise<ExecutionResult> {
  const {
    bundleCode,
    eventType,
    eventPayload,
    context,
    timeout, // Default provided by Zod schema
  } = options

  console.log('[Executor] Starting event execution:', { eventType })

  // Create execution promise
  const executionPromise = executeEventInSandbox(bundleCode, eventType, eventPayload, context)

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Event execution timeout')), timeout)
  })

  const { result, consoleLogs } = await Promise.race([executionPromise, timeoutPromise])

  return {
    result,
    metadata: {
      settingsSchema: getRegisteredSettingsSchema(),
      consoleLogs,
    },
  }
}

/**
 * Execute event in sandbox
 */
async function executeEventInSandbox(
  bundleCode: string,
  eventType: string,
  eventPayload: unknown,
  context: RuntimeContext
): Promise<{ result: unknown; consoleLogs: ConsoleLog[] }> {
  try {
    injectServerRuntimeHelpers(context)

    // Use Function constructor instead of import to access top-level variables
    const codeWithReturn = bundleCode + '\nreturn { stdin_events_default };'
    const fn = new Function(codeWithReturn)
    const handlers = fn()
    const stdin_events_default = handlers.stdin_events_default

    if (typeof stdin_events_default !== 'function') {
      throw new Error('Server bundle does not export stdin_events_default')
    }

    // Execute: stdin_events_default(eventType, [eventPayload])
    try {
      const result = await stdin_events_default(eventType, [eventPayload])

      const consoleLogs = getCapturedLogs()
      return { result, consoleLogs }
    } catch (error: unknown) {
      // Capture logs even on error
      const consoleLogs = getCapturedLogs()

      // Include captured console logs in the error for debugging
      if (consoleLogs.length > 0) {
        console.error('[Executor] App console logs before error:')
        consoleLogs.forEach((log) => {
          console.error(`  [App ${log.level}] ${log.message}`)
        })
      }

      // Re-throw with enhanced context
      throw error
    }
  } finally {
    cleanupServerRuntimeHelpers()
  }
}

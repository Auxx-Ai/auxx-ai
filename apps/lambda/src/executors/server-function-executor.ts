// apps/lambda/src/executors/server-function-executor.ts

/**
 * Server function executor for Lambda runtime.
 * Executes server functions in a Deno sandbox with Web Platform APIs only.
 *
 * Security model:
 * - NO Node.js built-ins (fs, http, path, etc.)
 * - ONLY Web Platform APIs (fetch, Response, Request, Headers)
 * - Timeout enforcement
 * - Memory limit enforcement (via Lambda config)
 */

import {
  type ConsoleLog,
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  getRegisteredSettingsSchema,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import type { ExecutionResult, RuntimeContext } from '../types.ts'
import { parseError } from '../utils.ts'
import type { FunctionExecutionEvent } from '../validator.ts'

/**
 * Execute server function in Deno sandbox
 * Uses FunctionExecutionEvent type from validator for type safety
 */
export async function executeServerFunction(
  options: Omit<FunctionExecutionEvent, 'context' | 'bundleKey'> & {
    bundleCode: string
    context: RuntimeContext
  }
): Promise<ExecutionResult> {
  const {
    bundleCode,
    functionIdentifier,
    functionArgs,
    context,
    timeout, // Default provided by Zod schema
    // memoryLimit, // Default provided by Zod schema
  } = options

  console.log('[Executor] Starting execution:', { functionIdentifier })

  // 1. Parse arguments
  let args: any[]
  try {
    args = JSON.parse(functionArgs)
  } catch (error: unknown) {
    const { message } = parseError(error)
    throw new Error(`Invalid function arguments JSON: ${message}`)
  }

  // 2. Create execution promise with timeout
  const executionPromise = executeInSandbox(bundleCode, functionIdentifier, args, context)

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Execution timeout')), timeout)
  })

  // 3. Race execution vs timeout
  const { result, consoleLogs } = await Promise.race([executionPromise, timeoutPromise])

  console.log('[Executor] Execution complete:', {
    functionIdentifier,
    logCount: consoleLogs.length,
  })

  // 4. Return result with metadata including logs
  return {
    result,
    metadata: {
      settingsSchema: getRegisteredSettingsSchema(),
      consoleLogs,
    },
  }
}

/**
 * Execute code in Deno sandbox with runtime helpers
 */
async function executeInSandbox(
  bundleCode: string,
  functionIdentifier: string,
  args: any[],
  context: RuntimeContext
): Promise<{ result: any; consoleLogs: ConsoleLog[] }> {
  try {
    // 1. Inject runtime helpers BEFORE executing bundle
    injectServerRuntimeHelpers(context)

    // 2. Use Function constructor to access top-level variables
    const codeWithReturn = bundleCode + '\nreturn { stdin_default };'
    const fn = new Function(codeWithReturn)
    const handlers = fn()
    const stdin_default = handlers.stdin_default

    if (typeof stdin_default !== 'function') {
      throw new Error('Server bundle does not export stdin_default function')
    }

    // 3. Execute the server function
    const result = await stdin_default(functionIdentifier, args)

    // 4. Get captured logs BEFORE cleanup
    const consoleLogs = getCapturedLogs()

    return { result, consoleLogs }
  } finally {
    // 5. Always clean up runtime helpers after execution
    cleanupServerRuntimeHelpers()
  }
}

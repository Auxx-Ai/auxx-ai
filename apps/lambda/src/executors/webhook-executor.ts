// apps/lambda/src/executors/webhook-executor.ts

/**
 * Webhook handler executor for Lambda runtime.
 * Executes app webhook handlers in a Deno sandbox with Web Platform Request/Response APIs.
 */

import type { ExecutionResult, RuntimeContext } from '../types.ts'
import type { WebhookExecutionEvent } from '../validator.ts'
import {
  injectServerRuntimeHelpers,
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  type ConsoleLog,
} from '../runtime-helpers/index.ts'

/**
 * Execute webhook handler
 * Uses WebhookExecutionEvent type from validator for type safety
 */
export async function executeWebhookHandler(
  options: Omit<WebhookExecutionEvent, 'context' | 'bundleKey'> & {
    bundleCode: string
    context: RuntimeContext
  }
): Promise<ExecutionResult> {
  const {
    bundleCode,
    handlerId,
    request,
    context,
    timeout  // Default provided by Zod schema
  } = options

  console.log('[Executor] Starting webhook execution:', { handlerId })

  const executionPromise = executeWebhookInSandbox(bundleCode, handlerId, request, context)

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Webhook execution timeout')), timeout)
  })

  const { result, consoleLogs } = await Promise.race([executionPromise, timeoutPromise])

  return {
    result,
    metadata: {
      consoleLogs,
    },
  }
}

/**
 * Execute webhook in sandbox
 */
async function executeWebhookInSandbox(
  bundleCode: string,
  handlerId: string,
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  },
  context: RuntimeContext
): Promise<{ result: any; consoleLogs: ConsoleLog[] }> {
  try {
    injectServerRuntimeHelpers(context)

    // Use Function constructor to access top-level variables
    const codeWithReturn = bundleCode + '\nreturn { stdin_webhooks_default };'
    const fn = new Function(codeWithReturn)
    const handlers = fn()
    const stdin_webhooks_default = handlers.stdin_webhooks_default

    if (typeof stdin_webhooks_default !== 'function') {
      throw new Error('Server bundle does not export stdin_webhooks_default')
    }

    // Create Web Platform Request object
    const webRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body || undefined,
    })

    // Execute: stdin_webhooks_default(handlerId, [Request])
    const response = await stdin_webhooks_default(handlerId, [webRequest])

    if (!(response instanceof Response)) {
      throw new Error('Webhook handler must return a Response object')
    }

    // Extract response data
    const responseData = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    }

    const consoleLogs = getCapturedLogs()

    return { result: responseData, consoleLogs }
  } finally {
    cleanupServerRuntimeHelpers()
  }
}

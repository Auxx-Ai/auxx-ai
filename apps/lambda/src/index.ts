// apps/lambda/src/index.ts

/**
 * AWS Lambda Handler for Server Function Execution
 *
 * This Lambda function executes extension server functions in a secure Deno sandbox.
 * It provides Web Platform APIs (fetch, Response, etc.) but NO Node.js built-ins.
 */

import { verifyInboundRequest } from './auth/verify-inbound.ts'
import { loadBundle } from './bundle-loader.ts'
import { createRuntimeContext } from './context-provider.ts'
import { executeCode } from './executors/code-executor.ts'
import { executeEventHandler } from './executors/event-executor.ts'
import { executePollingTrigger } from './executors/polling-trigger-executor.ts'
import { executeQuickAction } from './executors/quick-action-executor.ts'
import { executeServerFunction } from './executors/server-function-executor.ts'
import { executeWebhookHandler } from './executors/webhook-executor.ts'
import { executeWorkflowBlock } from './executors/workflow-block-executor.ts'
import { getCapturedLogs } from './runtime-helpers/console.ts'
import type { LambdaEvent, LambdaResponse } from './types.ts'
import { parseError } from './utils.ts'
import { type ValidatedLambdaEvent, validateLambdaEvent } from './validator.ts'

/**
 * Execution result type returned by all executors
 */
// interface ExecutionResult {
//   result: any
//   metadata?: {
//     settingsSchema?: any
//     consoleLogs?: any[]
//   }
// }

/**
 * Execute app-related events (function, event, webhook, workflow-block)
 * These events require bundle loading and runtime context creation
 */
async function executeAppEvent(validatedEvent: ValidatedLambdaEvent) {
  // Type guard: Only app events reach this function
  if (validatedEvent.type === 'code') {
    throw new Error('Invalid event type for app execution')
  }

  // Load bundle and create runtime context (required for all app events)
  const bundleCode = await loadBundle(validatedEvent.context.appId, validatedEvent.serverBundleSha)
  const context = createRuntimeContext(validatedEvent.context)

  // Route with type-specific guards for full type safety
  // Destructure inside each case after TypeScript narrows the union type
  switch (validatedEvent.type) {
    case 'event': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executeEventHandler({ ...eventData, bundleCode, context })
    }
    case 'webhook': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executeWebhookHandler({ ...eventData, bundleCode, context })
    }
    case 'workflow-block': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executeWorkflowBlock({ ...eventData, bundleCode, context })
    }
    case 'function': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executeServerFunction({ ...eventData, bundleCode, context })
    }
    case 'polling-trigger': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executePollingTrigger({ ...eventData, bundleCode, context })
    }
    case 'quick-action': {
      const { context: _, serverBundleSha: __, ...eventData } = validatedEvent
      return executeQuickAction({ ...eventData, bundleCode, context })
    }
  }
}

/**
 * Execute code event (standalone JavaScript/Python execution)
 * No bundle or runtime context needed - creates its own sandbox
 */
async function executeCodeEvent(validatedEvent: ValidatedLambdaEvent) {
  // Type guard to ensure we have code execution event
  if (validatedEvent.type !== 'code') {
    throw new Error('Invalid event type for code execution')
  }

  // Just pass the validated event directly - it matches CodeExecutionEvent type
  return await executeCode(validatedEvent)
}

/** Caller-type allowlist: which callers can invoke which event types */
const CALLER_TYPE_ALLOWLIST: Record<string, string[]> = {
  api: ['function', 'workflow-block'],
  'webhook-route': ['webhook'],
  'app-events': ['event'],
  'workflow-engine': ['workflow-block', 'code'],
  worker: ['workflow-block', 'code', 'event', 'polling-trigger'],
  'quick-action': ['quick-action'],
}

/** Maximum payload size (5 MB) */
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024

/**
 * Lambda handler - entry point for all server function executions
 */
export async function handler(
  event: LambdaEvent,
  meta?: { headers: Record<string, string>; rawBody: string }
): Promise<LambdaResponse> {
  const startTime = Date.now()

  try {
    // 0a. Payload size check
    if (meta?.rawBody && meta.rawBody.length > MAX_PAYLOAD_BYTES) {
      return {
        statusCode: 413,
        body: JSON.stringify({
          error: { message: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' },
        }),
      }
    }

    // 0b. Auth gate — reject unsigned requests
    const secret = Deno.env.get('LAMBDA_INVOKE_SECRET')
    let authCaller: string | undefined

    if (!secret) {
      if (Deno.env.get('NODE_ENV') !== 'development') {
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: { message: 'Auth not configured', code: 'AUTH_CONFIG_ERROR' },
          }),
        }
      }
    } else if (meta?.headers && meta?.rawBody) {
      const authResult = await verifyInboundRequest({
        headers: meta.headers,
        body: meta.rawBody,
        secret,
      })

      console.log('[Lambda:Auth]', {
        decision: authResult.valid ? 'accept' : 'reject',
        caller: authResult.caller,
        reason: authResult.reason,
        requestId: meta.headers['x-amzn-requestid'],
      })

      if (!authResult.valid) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: { message: authResult.reason, code: 'AUTH_FAILED' },
          }),
        }
      }
      authCaller = authResult.caller
    } else if (Deno.env.get('NODE_ENV') !== 'development') {
      return {
        statusCode: 401,
        body: JSON.stringify({
          error: { message: 'Missing auth headers', code: 'AUTH_REQUIRED' },
        }),
      }
    }

    // 1. Validate input - returns Zod safeParse result
    const validationResult = validateLambdaEvent(event)

    if (!validationResult.success) {
      // Format Zod's native error.issues
      const validationErrors = validationResult.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }))
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: validationErrors,
          },
          metadata: {
            duration: Date.now() - startTime,
          },
        }),
      }
    }

    const validatedEvent = validationResult.data
    const eventType = validatedEvent.type || 'function'

    // 1b. Caller-type allowlist check
    if (authCaller) {
      const allowed = CALLER_TYPE_ALLOWLIST[authCaller]
      if (!allowed || !allowed.includes(eventType)) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: {
              message: `Caller "${authCaller}" cannot invoke type "${eventType}"`,
              code: 'CALLER_TYPE_DENIED',
            },
          }),
        }
      }
    }

    // 2. Route to appropriate executor based on event type
    const executionResult =
      eventType === 'code'
        ? await executeCodeEvent(validatedEvent)
        : await executeAppEvent(validatedEvent)

    // 3. Format and return success response
    const duration = Date.now() - startTime

    console.log('[Lambda] Execution successful:', {
      type: eventType,
      caller: authCaller,
      duration,
      hasSettingsSchema: !!executionResult.metadata?.settingsSchema,
      logCount: executionResult.metadata?.consoleLogs?.length || 0,
    })

    return {
      statusCode: 200,
      body: JSON.stringify({
        execution_result: executionResult.result,
        metadata: {
          duration,
          cold_start: !(globalThis as Record<string, unknown>).__warm,
          settings_schema: executionResult.metadata?.settingsSchema,
          console_logs: executionResult.metadata?.consoleLogs,
          validation_error: executionResult.metadata?.validationError,
          runtime_error: executionResult.metadata?.runtimeError,
        },
      }),
    }
  } catch (error: unknown) {
    const duration = Date.now() - startTime
    const { message, code, stack, scope } = parseError(error)

    console.error('[Lambda] Execution failed:', {
      error: message,
      code,
      scope,
      stack,
      duration,
    })

    // Retrieve captured console logs before they're lost
    let console_logs: ReturnType<typeof getCapturedLogs> | undefined
    try {
      const logs = getCapturedLogs()
      if (logs.length > 0) {
        console_logs = logs
      }
    } catch {
      // Never let log retrieval fail the error response
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          message,
          code,
          scope,
          stack: Deno.env.get('NODE_ENV') === 'development' ? stack : undefined,
        },
        metadata: {
          duration,
          console_logs,
        },
      }),
    }
  } finally {
    // Mark Lambda as warm for next invocation
    ;(globalThis as Record<string, unknown>).__warm = true
  }
}

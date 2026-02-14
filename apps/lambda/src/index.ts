// apps/lambda/src/index.ts

import { loadBundle } from './bundle-loader.ts'
import { createRuntimeContext } from './context-provider.ts'
import { executeCode } from './executors/code-executor.ts'
import { executeEventHandler } from './executors/event-executor.ts'
/**
 * AWS Lambda Handler for Server Function Execution
 *
 * This Lambda function executes extension server functions in a secure Deno sandbox.
 * It provides Web Platform APIs (fetch, Response, etc.) but NO Node.js built-ins.
 */
import { executeServerFunction } from './executors/server-function-executor.ts'
import { executeWebhookHandler } from './executors/webhook-executor.ts'
import { executeWorkflowBlock } from './executors/workflow-block-executor.ts'
import type { LambdaEvent, LambdaResponse } from './types.ts'
import { parseError } from './utils.ts'
import { type ValidatedLambdaEvent, validateLambdaEvent } from './validator.ts'

/**
 * Execution result type returned by all executors
 */
interface ExecutionResult {
  result: any
  metadata?: {
    settingsSchema?: any
    consoleLogs?: any[]
  }
}

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
  const bundleCode = await loadBundle(validatedEvent.bundleKey)
  const context = createRuntimeContext(validatedEvent.context)

  // Route with type-specific guards for full type safety
  // Destructure inside each case after TypeScript narrows the union type
  switch (validatedEvent.type) {
    case 'event': {
      const { context: _, bundleKey: __, ...eventData } = validatedEvent
      return executeEventHandler({ ...eventData, bundleCode, context })
    }
    case 'webhook': {
      const { context: _, bundleKey: __, ...eventData } = validatedEvent
      return executeWebhookHandler({ ...eventData, bundleCode, context })
    }
    case 'workflow-block': {
      const { context: _, bundleKey: __, ...eventData } = validatedEvent
      return executeWorkflowBlock({ ...eventData, bundleCode, context })
    }
    case 'function': {
      const { context: _, bundleKey: __, ...eventData } = validatedEvent
      return executeServerFunction({ ...eventData, bundleCode, context })
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

/**
 * Lambda handler - entry point for all server function executions
 */
export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const startTime = Date.now()

  try {
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

    // 2. Route to appropriate executor based on event type
    const eventType = validatedEvent.type || 'function'
    const executionResult =
      eventType === 'code'
        ? await executeCodeEvent(validatedEvent)
        : await executeAppEvent(validatedEvent)

    // 3. Format and return success response
    const duration = Date.now() - startTime

    console.log('[Lambda] Execution successful:', {
      type: eventType,
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
        },
      }),
    }
  } finally {
    // Mark Lambda as warm for next invocation
    ;(globalThis as Record<string, unknown>).__warm = true
  }
}

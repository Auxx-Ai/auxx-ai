// packages/services/src/lambda-execution/invoke-lambda-executor.ts

import { LAMBDA_URL } from '@auxx/config/server'
import { signInboundRequest } from '@auxx/credentials/lambda-auth'
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'

/**
 * Console log entry from Lambda execution
 */
export interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  args: any[]
  timestamp: number
}

/**
 * Lambda execution result structure
 */
export interface LambdaExecutionResult {
  execution_result?: any
  metadata?: {
    duration?: number
    logs?: any[]
    consoleLogs?: ConsoleLog[]
    console_logs?: ConsoleLog[]
    /** Structured validation error returned by a BlockValidationError throw in execute() */
    validation_error?: {
      fields: Array<{ field: string; message: string }>
      message: string
    }
    /** Structured runtime error returned by a BlockRuntimeError throw in execute() */
    runtime_error?: {
      message: string
      code?: string
    }
  }
  error?: any
}

/**
 * Lambda execution error structure
 */
export interface LambdaExecutionError {
  code: string
  message: string
  details?: any
  statusCode: number
  consoleLogs?: ConsoleLog[]
}

/**
 * Standardized Lambda invocation with HMAC signing and error handling.
 * All Lambda invocations must go through this function.
 *
 * @param params.payload - The event payload to send to Lambda
 * @param params.caller - Identity of the calling service (used for caller-type allowlist)
 * @param params.lambdaUrl - Optional URL override (defaults to LAMBDA_URL)
 */
export async function invokeLambdaExecutor(params: {
  payload: any
  caller: string
  lambdaUrl?: string
}): Promise<Result<LambdaExecutionResult, LambdaExecutionError>> {
  const { payload, caller, lambdaUrl = LAMBDA_URL } = params

  console.log('[invoke-lambda] URL resolution debug:', {
    resolvedUrl: lambdaUrl,
    envLambdaUrl: process.env.LAMBDA_URL,
    configLambdaUrl: LAMBDA_URL,
    caller,
  })

  try {
    const body = JSON.stringify(payload)

    // Sign the request with HMAC-SHA256
    const secret = process.env.LAMBDA_INVOKE_SECRET
    const authHeaders = secret ? signInboundRequest({ body, caller, secret }) : {}

    const lambdaResponse = await fetch(lambdaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body,
    })

    if (!lambdaResponse.ok) {
      let errorData
      try {
        errorData = await lambdaResponse.json()
      } catch {
        const errorText = await lambdaResponse.text()
        errorData = { error: { message: errorText, code: 'UNKNOWN_ERROR' } }
      }

      // Extract console logs from error response metadata
      const errorConsoleLogs: ConsoleLog[] | undefined =
        errorData.metadata?.console_logs || errorData.metadata?.consoleLogs

      // Check for connection errors (not found or expired)
      if (
        errorData.error?.code === 'CONNECTION_NOT_FOUND' ||
        errorData.error?.code === 'CONNECTION_EXPIRED'
      ) {
        return err({
          code: 'CONNECTION_REQUIRED',
          message: errorData.error.message,
          details: {
            scope: errorData.error.scope || 'user',
          },
          statusCode: 403,
          consoleLogs: errorConsoleLogs,
        })
      }

      // Other errors
      return err({
        code: errorData.error?.code || 'EXECUTION_ERROR',
        message: errorData.error?.message || 'Lambda execution failed',
        details: errorData.error?.details,
        statusCode: lambdaResponse.status,
        consoleLogs: errorConsoleLogs,
      })
    }

    const result = await lambdaResponse.json()

    // Normalize console logs naming (some use consoleLogs, others console_logs)
    if (result.metadata?.console_logs && !result.metadata?.consoleLogs) {
      result.metadata.consoleLogs = result.metadata.console_logs
    }

    return ok(result as LambdaExecutionResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[invoke-lambda] Fetch failed:', {
      url: lambdaUrl,
      error: message,
      cause: error instanceof Error ? (error as any).cause?.message : undefined,
      code: error instanceof Error ? (error as any).cause?.code : undefined,
    })
    return err({
      code: 'LAMBDA_INVOCATION_ERROR',
      message: `Failed to invoke Lambda: ${message}`,
      statusCode: 500,
    })
  }
}

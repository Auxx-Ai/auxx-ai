// packages/services/src/lambda-execution/invoke-lambda-executor.ts

import { err, ok } from 'neverthrow'
import { SERVER_FUNCTION_EXECUTOR_URL } from '@auxx/config/server'
import type { Result } from 'neverthrow'

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
}

/**
 * Standardized Lambda invocation with error handling
 * Handles both server function and workflow block executions
 *
 * @param params - Object containing payload and optional Lambda URL
 * @returns Result with execution result or structured error
 */
export async function invokeLambdaExecutor(params: {
  payload: any
  lambdaUrl?: string
}): Promise<Result<LambdaExecutionResult, LambdaExecutionError>> {
  const { payload, lambdaUrl = SERVER_FUNCTION_EXECUTOR_URL } = params

  try {
    const lambdaResponse = await fetch(lambdaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!lambdaResponse.ok) {
      let errorData
      try {
        errorData = await lambdaResponse.json()
      } catch {
        const errorText = await lambdaResponse.text()
        errorData = { error: { message: errorText, code: 'UNKNOWN_ERROR' } }
      }

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
        })
      }

      // Other errors
      return err({
        code: errorData.error?.code || 'EXECUTION_ERROR',
        message: errorData.error?.message || 'Lambda execution failed',
        details: errorData.error?.details,
        statusCode: lambdaResponse.status,
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
    return err({
      code: 'LAMBDA_INVOCATION_ERROR',
      message: `Failed to invoke Lambda: ${message}`,
      statusCode: 500,
    })
  }
}

// apps/lambda/src/utils.ts

/**
 * Shared utility functions for Lambda executor
 */

/**
 * Parse error object in a type-safe manner
 */
export function parseError(error: unknown): { message: string; code: string; stack: string | undefined; scope?: string } {
  // Extract message
  const message = error instanceof Error ? error.message : String(error)

  // Extract stack
  const stack = error instanceof Error ? error.stack : undefined

  // Extract code (if it exists)
  let code = 'EXECUTION_ERROR'
  if (error instanceof Error && 'code' in error && typeof (error as Error & { code: unknown }).code === 'string') {
    code = (error as Error & { code: string }).code
  }

  // Extract scope (if it exists) for connection errors
  let scope: string | undefined
  if (error instanceof Error && 'scope' in error && typeof (error as Error & { scope: unknown }).scope === 'string') {
    scope = (error as Error & { scope: string }).scope
  }

  return { message, code, stack, scope }
}

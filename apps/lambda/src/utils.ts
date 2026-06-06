// apps/lambda/src/utils.ts

/**
 * Shared utility functions for Lambda executor
 */

/**
 * Parse error object in a type-safe manner
 */
export function parseError(error: unknown): {
  message: string
  code: string
  stack: string | undefined
  scope?: string
  details?: Record<string, unknown>
} {
  // Extract message
  const message = error instanceof Error ? error.message : String(error)

  // Extract stack
  const stack = error instanceof Error ? error.stack : undefined

  // Extract code (if it exists)
  let code = 'EXECUTION_ERROR'
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as Error & { code: unknown }).code === 'string'
  ) {
    code = (error as Error & { code: string }).code
  }

  // Extract scope (if it exists) for connection errors
  let scope: string | undefined
  if (
    error instanceof Error &&
    'scope' in error &&
    typeof (error as Error & { scope: unknown }).scope === 'string'
  ) {
    scope = (error as Error & { scope: string }).scope
  }

  // Forward the structured fields the typed `@auxx/sdk` errors carry so they
  // survive the sandbox boundary (e.g. RateLimitError.retryAfterSeconds,
  // InsufficientPermissionsError.requiredScopes, InvalidInputError.fields).
  let details: Record<string, unknown> | undefined
  if (error instanceof Error) {
    const extra: Record<string, unknown> = {}
    for (const key of ['retryAfterSeconds', 'requiredScopes', 'fields', 'resource', 'statusCode']) {
      const value = (error as unknown as Record<string, unknown>)[key]
      if (value !== undefined) extra[key] = value
    }
    if (Object.keys(extra).length > 0) details = extra
  }

  return { message, code, stack, scope, details }
}

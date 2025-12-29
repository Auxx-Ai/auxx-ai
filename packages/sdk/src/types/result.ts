// packages/sdk/src/types/result.ts

/**
 * Result type for operations that can succeed or fail
 * Provides type-safe error handling without throwing exceptions
 */
export type Result<T, E> = { success: true; value: T } | { success: false; error: E }

/**
 * Type guard to check if result is successful
 */
export function isSuccess<T, E>(result: Result<T, E>): result is { success: true; value: T } {
  return result.success
}

/**
 * Type guard to check if result is an error
 */
export function isError<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success
}

/**
 * Unwrap a successful result, throwing if it's an error
 * Use with caution - prefer pattern matching with isSuccess/isError
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.success) {
    throw new Error('Attempted to unwrap an error result')
  }
  return result.value
}

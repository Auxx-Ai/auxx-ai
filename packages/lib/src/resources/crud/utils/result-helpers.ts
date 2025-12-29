// packages/lib/src/resources/crud/utils/result-helpers.ts

import type { Result } from 'neverthrow'
import type { CrudResult } from '../types'

/**
 * Convert a neverthrow Result to a CrudResult.
 */
export function fromDbResult<T extends { id: string }>(
  result: Result<T | null | undefined, { message: string; code?: string }>,
  notFoundMessage?: string
): CrudResult<T> {
  if (result.isErr()) {
    return {
      success: false,
      error: result.error.message,
      errorCode: result.error.code,
    }
  }

  if (!result.value) {
    return {
      success: false,
      error: notFoundMessage ?? 'Record not found',
      errorCode: 'NOT_FOUND',
    }
  }

  return {
    success: true,
    id: result.value.id,
    record: result.value,
  }
}

/**
 * Check if a db result indicates not found.
 */
export function isNotFound(result: Result<unknown, { code?: string }>): boolean {
  return result.isErr() && result.error.code === 'NOT_FOUND'
}

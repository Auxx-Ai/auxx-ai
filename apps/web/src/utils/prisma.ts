// apps/web/src/utils/prisma.ts

import { databaseErrorCodes, NotFoundError } from '@auxx/lib/errors'
import { DrizzleError } from 'drizzle-orm/errors'
import { DatabaseError } from 'pg'

// Unique constraint violation SQLSTATE code
const UNIQUE_VIOLATION_CODE = databaseErrorCodes.uniqueViolation

// SQLSTATE codes that Postgres emits when a requested record is missing
const NOT_FOUND_SQLSTATES = new Set(['02000', 'P0002'])

// Extracts the underlying DatabaseError from Drizzle or pg failures
const getDatabaseError = (error: unknown) => {
  if (error instanceof DatabaseError) return error
  if (error instanceof DrizzleError && error.cause instanceof DatabaseError) return error.cause
  if (
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    (error as any).cause instanceof DatabaseError
  ) {
    return (error as { cause: DatabaseError }).cause
  }
  return undefined
}

// Determines if an error was triggered by a unique constraint violation
export function isDuplicateError(error: unknown, key?: string) {
  const dbError = getDatabaseError(error)
  if (!dbError || dbError.code !== UNIQUE_VIOLATION_CODE) return false

  if (!key) return true

  if (typeof dbError.constraint === 'string' && dbError.constraint.includes(key)) return true

  if (typeof dbError.detail === 'string') {
    return dbError.detail.includes(`(${key})`) || dbError.detail.includes(`"${key}"`)
  }

  return false
}

// Determines if an error represents a missing record during a database operation
export function isNotFoundError(error: unknown) {
  if (error instanceof NotFoundError) return true

  const dbError = getDatabaseError(error)
  if (!dbError) return false

  return Boolean(dbError.code && NOT_FOUND_SQLSTATES.has(dbError.code))
}

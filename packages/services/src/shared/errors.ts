// packages/services/src/shared/errors.ts

/**
 * Base error interface for all service errors
 */
export interface ServiceError {
  code: string
  message: string
  context?: Record<string, unknown>
  cause?: unknown
}

/**
 * Database operation errors
 */
export type DatabaseError = {
  code: 'DATABASE_ERROR'
  message: string
  cause: unknown
}

/**
 * S3 operation errors
 */
export type S3Error = {
  code: 'S3_ERROR'
  message: string
  cause: unknown
}

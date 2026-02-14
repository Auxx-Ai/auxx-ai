// apps/api/src/lib/utils.ts

import { fromPromise, type Result, type ResultAsync } from 'neverthrow'

/**
 * Database error type with literal code
 */
export type DatabaseError = {
  code: 'DATABASE_ERROR'
  message: string
  cause: unknown
}

/**
 * S3 error type with literal code
 */
export type S3Error = {
  code: 'S3_ERROR'
  message: string
  cause: unknown
}

/**
 * Wrap database queries with error handling using neverthrow
 *
 * Converts a database promise into a Result type that can be safely composed
 * with other operations without throwing exceptions.
 *
 * @param promise - The database query promise to wrap
 * @param errorCode - A descriptive error code/operation name for debugging
 * @returns A Result containing either the query result or a DATABASE_ERROR
 *
 * @example
 * ```typescript
 * const result = await fromDatabase(
 *   db.query.Users.findFirst({ where: eq(users.id, userId) }),
 *   'find-user-by-id'
 * )
 *
 * if (result.isErr()) {
 *   console.error('Database error:', result.error.message)
 *   return err(result.error)
 * }
 *
 * const user = result.value
 * ```
 */
export function fromDatabase<T>(
  promise: Promise<T>,
  errorCode: string
): ResultAsync<T, DatabaseError> {
  return fromPromise(
    promise,
    (cause): DatabaseError => ({
      code: 'DATABASE_ERROR',
      message: `Database operation failed: ${errorCode}`,
      cause,
    })
  )
}

/**
 * Wrap S3 operations with error handling using neverthrow
 *
 * Converts an S3 operation promise into a Result type that can be safely
 * composed with other operations without throwing exceptions.
 *
 * @param promise - The S3 operation promise to wrap
 * @param operation - A descriptive operation name for debugging
 * @returns A Result containing either the operation result or an S3_ERROR
 *
 * @example
 * ```typescript
 * const result = await fromS3(
 *   s3Client.send(new GetObjectCommand({ Bucket, Key })),
 *   'get-object'
 * )
 *
 * if (result.isErr()) {
 *   console.error('S3 error:', result.error.message)
 *   return err(result.error)
 * }
 *
 * const object = result.value
 * ```
 */
export function fromS3<T>(promise: Promise<T>, operation: string): ResultAsync<T, S3Error> {
  return fromPromise(
    promise,
    (cause): S3Error => ({
      code: 'S3_ERROR',
      message: `S3 operation failed: ${operation}`,
      cause,
    })
  )
}

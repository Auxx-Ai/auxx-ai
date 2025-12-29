// packages/services/src/shared/utils.ts

import { ResultAsync } from 'neverthrow'
import type { DatabaseError, S3Error } from './errors'

/**
 * Wrap database operations in Result type for error handling
 */
export function fromDatabase<T>(
  promise: Promise<T>,
  errorCode: string
): ResultAsync<T, DatabaseError> {
  return ResultAsync.fromPromise(promise, (error) => ({
    code: 'DATABASE_ERROR' as const,
    message: `Database operation "${errorCode}" failed`,
    cause: error,
  }))
}

/**
 * Wrap S3 operations in Result type for error handling
 */
export function fromS3<T>(
  promise: Promise<T>,
  operation: string
): ResultAsync<T, S3Error> {
  return ResultAsync.fromPromise(promise, (error) => ({
    code: 'S3_ERROR' as const,
    message: `S3 operation "${operation}" failed`,
    cause: error,
  }))
}

/**
 * Format semantic version components into version string
 */
export function formatVersion(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch}`
}

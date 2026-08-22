// packages/lib/src/files/storage/errors.ts

/**
 * Translating adapter throws into `AuxxError`s, without losing them.
 *
 * `files/guard.ts` returns `err(error)` only for an {@link AuxxError} and
 * flattens everything else to `AuxxError('Internal error')`. That is right for a
 * database read, where anything unexpected really is a 500 — but every failure a
 * `StoragePort` call can produce is an *adapter* error (`StorageAdapterError`,
 * `StorageAuthError`, `StorageFileNotFoundError`), and none of those extend
 * `AuxxError`. Wrapping `port.head(...)` in the plain guard would therefore turn
 * `File not found: org-1/x.pdf` into `Internal error` for every caller —
 * including the upload-complete route, which puts `String(err)` straight into
 * the failure it publishes to the client.
 *
 * So the storage functions use {@link storageGuard}, which maps the adapter's
 * three classes onto the matching `AuxxError` subclasses **verbatim**: same
 * message, and the original hung off `cause` so a caller that needs the adapter
 * type back can have it. `StorageManager.handleStorageError` uses exactly that
 * to keep its legacy throw shape byte-for-byte.
 *
 * Anything that is not an adapter error and not an `AuxxError` still goes
 * through `guard` and is still logged and flattened — an unknown throw from
 * inside `files/storage` is a bug, not a business rule.
 */

import type { Result } from 'neverthrow'
import { AuxxError, NotFoundError, UnauthorizedError } from '../../errors'
import {
  StorageAdapterError,
  StorageAuthError,
  StorageFileNotFoundError,
} from '../adapters/base-adapter'
import { guard } from '../guard'

/**
 * The adapter error a mapped {@link AuxxError} came from, if any.
 *
 * The one supported way back to the adapter class. `StorageManager` uses it so
 * its callers keep seeing `StorageFileNotFoundError` rather than a `NotFoundError`
 * they have never handled.
 */
export function storageErrorCause(error: unknown): StorageAdapterError | undefined {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause
  return cause instanceof StorageAdapterError ? cause : undefined
}

/** Attach `original` as the cause without widening the return type. */
function withCause<E extends AuxxError>(mapped: E, original: Error): E {
  mapped.cause = original
  return mapped
}

/**
 * Map a storage adapter error onto the `AuxxError` subclass with the right
 * status, or `undefined` when it is not an adapter error at all.
 *
 * Ordered most-specific first: `StorageAuthError` and `StorageFileNotFoundError`
 * both extend `StorageAdapterError`, so the base class must be tested last.
 */
export function toStorageAuxxError(error: unknown): AuxxError | undefined {
  if (error instanceof AuxxError) return error
  if (error instanceof StorageFileNotFoundError) {
    return withCause(new NotFoundError(error.message), error)
  }
  if (error instanceof StorageAuthError) {
    return withCause(new UnauthorizedError(error.message), error)
  }
  if (error instanceof StorageAdapterError) {
    // Deliberately the base `AuxxError` (500), not `BadRequestError`: a generic
    // adapter failure is a network fault or an unsupported operation, and
    // neither is the caller's input being wrong.
    return withCause(new AuxxError(error.message), error)
  }
  return undefined
}

/**
 * {@link guard}, plus the adapter-error mapping above.
 *
 * Use this for any function whose body calls a {@link StoragePort}. Use the
 * plain `guard` for database-only functions — mapping there would claim a
 * meaning the error does not have.
 */
export async function storageGuard<T>(
  fn: () => Promise<T>,
  logMessage: string,
  meta: Record<string, unknown> = {}
): Promise<Result<T, AuxxError>> {
  return guard(
    async () => {
      try {
        return await fn()
      } catch (error) {
        throw toStorageAuxxError(error) ?? error
      }
    },
    logMessage,
    meta
  )
}

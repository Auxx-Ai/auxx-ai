// packages/lib/src/files/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('files')

/**
 * Take the value out of a `Result`, re-throwing its error.
 *
 * The inverse of {@link guard}, and the seam that lets a Style-A body call the
 * `Result`-returning functions this module is made of without an `.andThen`
 * ladder: `unwrap(await createStorageLocation(tx, ctx, input))` throws the
 * `AuxxError` the outer `guard` will convert, and — crucially — throws it
 * *inside* any transaction the caller has open, so the transaction rolls back.
 *
 * Returning `err()` from inside `db.transaction` does **not** roll back: an
 * `err` is an ordinary resolved value, the body completes normally, and the
 * caller commits the rows it was just told failed to write. That is the single
 * easiest way to reintroduce a bug on the upload path, and this function is
 * what makes the correct form a one-liner.
 */
export function unwrap<T>(result: Result<T, AuxxError>): T {
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * Run an imperative helper body that may `throw` an {@link AuxxError} for known
 * business-rule failures, and convert the outcome into a neverthrow `Result`.
 *
 * - Thrown `AuxxError`s are returned as `err(error)` and mapped to the right
 *   HTTP/tRPC code by the router's `auxxErrorMiddleware`.
 * - Any other (unexpected) error is logged and surfaced as a generic 500.
 */
export async function guard<T>(
  fn: () => Promise<T>,
  logMessage: string,
  meta: Record<string, unknown> = {}
): Promise<Result<T, AuxxError>> {
  try {
    return ok(await fn())
  } catch (error) {
    if (error instanceof AuxxError) {
      return err(error)
    }
    logger.error(logMessage, { error, ...meta })
    return err(new AuxxError('Internal error'))
  }
}

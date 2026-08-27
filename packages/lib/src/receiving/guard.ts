// packages/lib/src/receiving/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('receiving')

/**
 * Run an imperative helper body that may `throw` an {@link AuxxError} for known
 * business-rule failures, and convert the outcome into a neverthrow `Result`.
 *
 * Copied from `snippets/guard.ts` per `docs/lib-module-guide.md` section 3 — it is
 * small enough that duplicating it beats a shared abstraction, and duplicating it
 * is what lets this module bind its own `createScopedLogger` scope so a receipt
 * failure is greppable as `scope='receiving'` rather than as somebody else's.
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

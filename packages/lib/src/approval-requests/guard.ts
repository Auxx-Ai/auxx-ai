// packages/lib/src/approval-requests/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('approval-requests')

/**
 * Run an imperative helper body that may `throw` an {@link AuxxError} for known
 * business-rule failures, and convert the outcome into a neverthrow `Result`.
 *
 * - Thrown `AuxxError`s are returned as `err(error)` and mapped to the right
 *   HTTP/tRPC code by the router's `auxxErrorMiddleware`.
 * - Any other (unexpected) error is logged and surfaced as a generic 500.
 *
 * Duplicated from `snippets/guard.ts` / `email/labels/guard.ts` on purpose
 * (module guide §3): 31 lines is cheaper than a shared abstraction, and it lets
 * this module bind its own logger scope so approval failures are greppable as
 * `scope='approval-requests'`.
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

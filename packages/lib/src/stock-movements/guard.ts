// packages/lib/src/stock-movements/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('stock-movements')

/**
 * Run an imperative helper body that may `throw` an {@link AuxxError} for
 * known business-rule failures, and convert the outcome into a neverthrow
 * `Result`.
 *
 * Copied from `snippets/guard.ts` per `docs/lib-module-guide.md` §3 and
 * `receiving/guard.ts` - small enough that duplicating it beats a shared
 * abstraction, and duplicating it is what lets this module bind its own
 * `createScopedLogger` scope.
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

// packages/lib/src/returns/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('returns')

/**
 * Run an imperative body that may `throw` an {@link AuxxError} for a known
 * business-rule failure, and convert the outcome into a neverthrow `Result`.
 *
 * Copied from `snippets/guard.ts` per `docs/lib-module-guide.md` section 3: it
 * is small enough that duplicating it beats a shared abstraction, and
 * duplicating it is what lets this module bind its own `createScopedLogger`
 * scope so a refused return is greppable as `scope='returns'`.
 *
 * The typed refusals in `salvage-errors.ts` are `AuxxError` subclasses, so a
 * guard body may `throw` one and the caller still receives it intact rather
 * than as a flattened internal error.
 */
export async function guard<T>(
  fn: () => Promise<T>,
  logMessage: string,
  meta: Record<string, unknown> = {}
): Promise<Result<T, AuxxError>> {
  try {
    return ok(await fn())
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error(logMessage, { error, ...meta })
    return err(new AuxxError('Internal error'))
  }
}

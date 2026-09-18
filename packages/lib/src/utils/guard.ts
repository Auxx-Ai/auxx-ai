// packages/lib/src/utils/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

/**
 * Factory that creates a module-scoped neverthrow wrapper with logging.
 */
export function createGuard(scope: string) {
  const logger = createScopedLogger(scope)

  return async function guard<T>(
    fn: () => Promise<T>,
    logMessage: string,
    meta: Record<string, unknown> = {}
  ): Promise<Result<T, AuxxError>> {
    try {
      return ok(await fn())
    } catch (error) {
      if (error instanceof AuxxError) {
        // `warn`, not `error`: a refusal is a business-rule outcome, but it still
        // has to leave a trace - the remedy string used to exist only in the browser.
        logger.warn(logMessage, {
          ...meta,
          error: error.message,
          errorName: error.name,
          statusCode: error.statusCode,
        })
        return err(error)
      }
      logger.error(logMessage, { error, ...meta })
      return err(new AuxxError('Internal error'))
    }
  }
}

/**
 * Throws the `Result`'s error so it propagates inside an open transaction; returning `err()` there would not roll back.
 */
export function unwrap<T>(result: Result<T, AuxxError>): T {
  if (result.isErr()) throw result.error
  return result.value
}

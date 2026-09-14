// packages/lib/src/returns/intake/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'

const logger = createScopedLogger('returns:intake')

/**
 * Run an imperative body that may `throw` an {@link AuxxError} for a known
 * business-rule failure, and convert the outcome into a neverthrow `Result`.
 *
 * The same wrapper `snippets/guard.ts` and `purchasing/intake/guard.ts`
 * document, bound to this module's own logger scope so a return-intake failure
 * is greppable on its own. Copying it beats sharing it: the duplication is
 * smaller than the coupling.
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

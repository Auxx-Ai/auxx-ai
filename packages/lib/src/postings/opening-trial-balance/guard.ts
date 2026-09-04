// packages/lib/src/postings/opening-trial-balance/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'

const logger = createScopedLogger('postings:opening-trial-balance')

/**
 * Run an imperative body that may `throw` an {@link AuxxError} for known
 * business-rule failures, and convert the outcome into a neverthrow `Result`.
 *
 * Copied from `snippets/guard.ts` per `docs/lib-module-guide.md` §3 - small
 * enough that duplicating it beats a shared abstraction, and duplicating it is
 * what lets this module bind its own scope so a refused opening balance is
 * greppable as `scope='postings:opening-trial-balance'` rather than hiding
 * inside the journal-entry module's log stream.
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

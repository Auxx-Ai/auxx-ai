// packages/lib/src/data-deletion/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('data-deletion')

/**
 * Run an imperative body that may `throw` an {@link AuxxError} for known
 * business-rule failures and convert the outcome into a neverthrow `Result`.
 *
 * Copied per-module on purpose (see `snippets/guard.ts`) so each module binds
 * its own logger scope; it is 20 lines and a shared abstraction would buy
 * nothing.
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

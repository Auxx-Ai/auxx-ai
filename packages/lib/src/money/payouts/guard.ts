// packages/lib/src/money/payouts/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'

const logger = createScopedLogger('payouts')

/**
 * Run a body that may `throw` an {@link AuxxError} for a known refusal and
 * convert the outcome into a neverthrow `Result`.
 *
 * Copied from `bank-deposits/guard.ts` per `docs/lib-module-guide.md` §3 - small
 * enough that duplicating it beats a shared abstraction, and duplicating it is
 * what lets this module bind its own logger scope, so a refused payout is
 * greppable as `scope='payouts'`.
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

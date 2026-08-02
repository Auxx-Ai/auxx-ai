// packages/lib/src/mail-unsubscribe/guard.ts
// The module's neverthrow wrapper (docs/lib-module-guide.md §3 style A). Copied
// from `snippets/guard.ts` rather than shared, so this module binds its own
// `createScopedLogger` scope — the file is small enough that duplication beats
// an abstraction.

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../errors'

const logger = createScopedLogger('mail-unsubscribe')

/**
 * Run an imperative body that may `throw` an {@link AuxxError} for known
 * business-rule failures, and convert the outcome into a neverthrow `Result`.
 *
 * - Thrown `AuxxError`s come back as `err(error)` and the router's
 *   `auxxErrorMiddleware` maps them to the right status.
 * - Anything else is logged and surfaced as a generic 500 — a third-party
 *   endpoint's response body must never reach the caller verbatim.
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

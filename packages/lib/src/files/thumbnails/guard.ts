// packages/lib/src/files/thumbnails/guard.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'

const logger = createScopedLogger('files:thumbnails')

/**
 * `files/guard.ts` with a thumbnails-specific logger scope.
 *
 * Same contract as the shared guard — an imperative body throws `AuxxError`
 * subclasses for known failures, anything else is logged and flattened to a
 * generic 500 — and it exists only so the scope is greppable.
 *
 * That is worth twenty lines here specifically because most thumbnail work runs
 * unattended: the nightly `thumbnailCleanupJob` and the `generateThumbnail`
 * worker have no user watching them, so `scope='files:thumbnails'` in
 * OpenObserve is how a silent sweep failure gets noticed at all. Reads and
 * writes elsewhere in `files/` surface through a router response and do not need
 * their own scope.
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

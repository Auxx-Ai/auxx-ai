// packages/lib/src/apps/connections/mark-app-connection-expired.ts

import { recordRefreshFailure } from '@auxx/credentials/store'
import { logger } from '@auxx/services/app-connections'
import { err, ok } from 'neverthrow'

/**
 * Mark an app connection as expired/broken.
 *
 * Reuses the existing circuit-breaker fields written by the OAuth2 token
 * refresh path (`consecutiveRefreshFailures` / `lastRefreshFailureAt`) so a
 * connection that fails at tool-execution time (e.g. the provider rejected the
 * token with a 401/403) surfaces in the UI exactly like a refresh failure does.
 *
 * Idempotent: re-marking an already-open connection just refreshes the
 * timestamp. Does not throw — returns a neverthrow Result.
 */
export async function markAppConnectionExpired(params: {
  credentialId: string
  organizationId: string
}) {
  const { credentialId, organizationId } = params

  // A `permanent` failure jumps the breaker straight to the open threshold + stamps the
  // failure time — the same fields the OAuth2 refresh path writes.
  const result = await recordRefreshFailure(credentialId, organizationId, { permanent: true })

  if (result.isErr()) {
    return err(result.error)
  }

  logger.info('Marked app connection expired', { credentialId })
  return ok(undefined)
}

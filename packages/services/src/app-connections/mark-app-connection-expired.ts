// packages/services/src/app-connections/mark-app-connection-expired.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { logger } from './utils'

/**
 * Number of consecutive failures at which the refresh circuit breaker is
 * considered "open" — mirrors `OAuth2WorkflowService` (a permanent failure
 * jumps straight to this value). A connection at or above this count is
 * surfaced as `expired` by {@link listAppConnections}.
 */
export const CONNECTION_CIRCUIT_OPEN_THRESHOLD = 5

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

  const result = await fromDatabase(
    database
      .update(schema.WorkflowCredentials)
      .set({
        consecutiveRefreshFailures: CONNECTION_CIRCUIT_OPEN_THRESHOLD,
        lastRefreshFailureAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.WorkflowCredentials.id, credentialId),
          eq(schema.WorkflowCredentials.organizationId, organizationId)
        )
      ),
    'mark-app-connection-expired'
  )

  if (result.isErr()) {
    return result
  }

  logger.info('Marked app connection expired', { credentialId })
  return ok(undefined)
}

// packages/credentials/src/store/record-refresh.ts

import { database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, notFound } from './internal'
import type { CredentialStoreError } from './types'

/** Circuit-breaker threshold: at/above this many consecutive failures, a credential needs reconnect. */
const PERMANENT_FAILURE_THRESHOLD = 5

/**
 * Record a successful token refresh: reset the failure breaker, clear any classified auth-error
 * state (`requiresReauth` / `lastAuthError` / `lastAuthErrorAt`), and stamp `lastRefreshAt`. A
 * fresh token means the credential is healthy again, so this is also the reconnect recovery path —
 * without clearing the reauth flags the UI keeps surfacing "Auth required". The only writer (with
 * {@link recordRefreshFailure}) of the breaker fields. Org-scoped.
 */
export async function recordRefreshSuccess(
  id: string,
  organizationId: string,
  options: { expiresAt: Date | null }
): Promise<Result<void, CredentialStoreError>> {
  const now = new Date()
  const updateResult = await fromDb(
    database
      .update(schema.Credential)
      .set({
        consecutiveRefreshFailures: 0,
        requiresReauth: false,
        lastAuthError: null,
        lastAuthErrorAt: null,
        lastRefreshAt: now,
        expiresAt: options.expiresAt,
        updatedAt: now,
      })
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'record-refresh-success'
  )

  if (updateResult.isErr()) return err(updateResult.error)
  if (updateResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}

/**
 * Record a failed token refresh: increment the breaker (a `permanent` failure jumps straight to
 * the reconnect threshold) and stamp `lastRefreshFailureAt`. Org-scoped.
 */
export async function recordRefreshFailure(
  id: string,
  organizationId: string,
  options?: { permanent?: boolean }
): Promise<Result<void, CredentialStoreError>> {
  const now = new Date()
  const nextFailures = options?.permanent
    ? sql`${PERMANENT_FAILURE_THRESHOLD}`
    : sql`${schema.Credential.consecutiveRefreshFailures} + 1`

  const updateResult = await fromDb(
    database
      .update(schema.Credential)
      .set({
        consecutiveRefreshFailures: nextFailures,
        lastRefreshFailureAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(schema.Credential.id, id), eq(schema.Credential.organizationId, organizationId))
      )
      .returning({ id: schema.Credential.id }),
    'record-refresh-failure'
  )

  if (updateResult.isErr()) return err(updateResult.error)
  if (updateResult.value.length === 0) return err(notFound(id))
  return ok(undefined)
}

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
        lastRefreshError: null,
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
 * the reconnect threshold), stamp `lastRefreshFailureAt`, and persist `authError` as
 * `lastRefreshError` — the raw diagnostic text, kept for **every** failure.
 *
 * That last part is the difference between a diagnosable outage and a silent one. The breaker
 * latches at 5 failures and the scanner then skips the credential for 24h, so a credential failing
 * for a *transient*-classified reason can sit dead indefinitely; before `lastRefreshError` existed
 * the provider's message went only to the logger, and by the time anyone looked the logs had
 * rotated. Keep writing it unconditionally.
 *
 * A permanent failure (revoked/invalid refresh token — e.g. OAuth2 `invalid_grant`) *additionally*
 * sets the classified reauth state (`requiresReauth` / `lastAuthError` / `lastAuthErrorAt`), since
 * no retry can recover it — only a reconnect. `lastAuthError` stays a **classified** signal the UI
 * reads (an AuthErrorType such as `'invalid_grant'`); raw provider text belongs in
 * `lastRefreshError`, never here. `recordRefreshSuccess` clears both. Org-scoped.
 */
export async function recordRefreshFailure(
  id: string,
  organizationId: string,
  options?: { permanent?: boolean; authError?: string; authErrorType?: string }
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
        // Always recorded — this is the forensic trail for transient failures.
        lastRefreshError: options?.authError ?? 'Token refresh failed',
        updatedAt: now,
        ...(options?.permanent && {
          requiresReauth: true,
          // Classified type when the caller knows it; the generic marker otherwise. Never the raw
          // provider message — that is what lastRefreshError is for.
          lastAuthError: options.authErrorType ?? 'refresh_failed',
          lastAuthErrorAt: now,
        }),
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

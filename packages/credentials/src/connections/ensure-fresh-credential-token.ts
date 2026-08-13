// packages/credentials/src/connections/ensure-fresh-credential-token.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('ensure-fresh-credential-token')

/** Hard ceiling on the refresh-ahead window. */
const MAX_SKEW_MS = 120_000
/** Fraction of the token lifetime used as the refresh-ahead window for short-lived tokens. */
const SKEW_LIFETIME_FRACTION = 0.25
/** Lock TTL — bounds a crashed holder; a refresh roundtrip is well under this. */
const LOCK_TTL_SECONDS = 30
const LOCK_POLLS = 3
const LOCK_POLL_DELAY_MS = 500

/** One lock space for all credential kinds — the refresh path (`refreshCredentialTokens`) is shared. */
const lockKey = (credentialId: string) => `credential:token-refresh:${credentialId}`

/**
 * Minimal distributed-lock surface used to make refreshes single-flight per credential.
 *
 * Injected rather than imported: this package sits below `@auxx/redis` in the dependency graph
 * (redis itself imports `configService` from here), so a direct redis import would be a cycle.
 * `@auxx/redis` ships the canonical implementation — see `createCredentialLockProvider`.
 *
 * Every method may reject; callers treat a throwing provider as "no lock available" and refresh
 * anyway, so an implementation never needs to swallow its own errors.
 */
export interface CredentialLockProvider {
  /** Set-if-absent with a TTL. Resolves `false` when another holder already has the key. */
  acquire(key: string, ttlSeconds: number): Promise<boolean>
  /** Whether the key is currently held. Used to wait out a competing refresh. */
  isHeld(key: string): Promise<boolean>
  /** Best-effort release. */
  release(key: string): Promise<void>
}

/**
 * Refresh-ahead window: `min(120s, 25% of token lifetime)`. A fixed window would make any token
 * with a TTL at or under it permanently "expiring" — refreshing on every call and rotating the
 * refresh token each time.
 */
function expirySkewMs(input: {
  expiresAt: Date
  lastRefreshAt?: Date | null
  createdAt?: Date
}): number {
  const issuedAt = input.lastRefreshAt ?? input.createdAt
  if (!issuedAt) return MAX_SKEW_MS
  const lifetimeMs = input.expiresAt.getTime() - issuedAt.getTime()
  if (lifetimeMs <= 0) return MAX_SKEW_MS
  return Math.min(MAX_SKEW_MS, lifetimeMs * SKEW_LIFETIME_FRACTION)
}

/**
 * Ensure the credential carries a fresh access token, producing one when it's expired/near expiry
 * (single-flight per credential via the injected `lock` — concurrent mints/refreshes would persist
 * a dead rotation). Two grants share this seam:
 *
 * - `refresh_token` (default): refresh only when a refresh token exists and the token is at/near
 *   expiry. `!expiresAt` means "can't tell" → leave it to the caller's 401 path.
 * - `client-credentials`: there is no refresh token and no browser — re-mint from the org's
 *   id/secret. The trigger inverts: `!expiresAt` (no token minted yet) means "**mint now**", and a
 *   stored expiry near the skew window re-mints.
 *
 * Routes through `refreshCredentialTokens` / `mintClientCredentialToken` accordingly. Returns
 * `true` when the stored secrets may have changed (work ran here, or another process held the
 * lock) so the caller knows to re-reveal; `false` means nothing happened. Never throws: a failure
 * leaves the stored token in place for the caller's 401 path, and the workflow stamps the breaker.
 *
 * `lock` is optional and best-effort by design: omitted or throwing, the refresh still proceeds
 * unserialised — correctness beats stampede protection, and that is the pre-existing behaviour
 * when Redis is unreachable.
 */
export async function ensureFreshCredentialToken(input: {
  credentialId: string
  organizationId: string
  expiresAt?: Date | null
  lastRefreshAt?: Date | null
  createdAt?: Date
  hasRefreshToken: boolean
  /** Which grant produces the fresh token. Default `refresh_token`. */
  grant?: 'refresh_token' | 'client-credentials'
  /** Skip the expiry check — used by the 401 retry path where the token just failed live. */
  force?: boolean
  /** Single-flight lock. Omit to refresh without serialisation. */
  lock?: CredentialLockProvider | null
}): Promise<boolean> {
  const { credentialId, organizationId, expiresAt, hasRefreshToken, force } = input
  const grant = input.grant ?? 'refresh_token'

  // refresh_token can't proceed without a refresh token; client-credentials always can (it mints).
  if (grant === 'refresh_token' && !hasRefreshToken) return false
  if (!force) {
    if (!expiresAt) {
      // refresh: can't tell → 401 path owns it. client-credentials: no token yet → mint now.
      if (grant === 'refresh_token') return false
    } else {
      const skew = expirySkewMs({
        expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        createdAt: input.createdAt,
      })
      if (expiresAt.getTime() - Date.now() > skew) return false
    }
  }

  let lock: CredentialLockProvider | null = input.lock ?? null
  const key = lockKey(credentialId)

  if (lock) {
    const held = lock
    try {
      const acquired = await held.acquire(key, LOCK_TTL_SECONDS)
      if (!acquired) {
        // Someone else is refreshing — wait for the lock to clear, then let the caller re-read
        // whatever the winner persisted. Never fail the call over lock contention.
        for (let i = 0; i < LOCK_POLLS; i++) {
          await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS))
          if (!(await held.isHeld(key))) break
        }
        return true
      }
    } catch {
      lock = null // lock machinery failed — refresh anyway
    }
  }

  try {
    // Lazy import: oauth2-token-grants pulls in the heavy workflow-nodes graph, which this
    // low-level module must not load statically (breaks test mock interception too).
    const grants = await import('./oauth2-token-grants')
    const result =
      grant === 'client-credentials'
        ? await grants.mintClientCredentialToken(credentialId, organizationId)
        : await grants.refreshCredentialTokens(credentialId, organizationId)
    if (!result.success) {
      logger.warn('Credential token refresh failed', { credentialId, grant, error: result.error })
    }
  } catch (error) {
    logger.warn('Credential token refresh threw', {
      credentialId,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (lock) {
      try {
        await lock.release(key)
      } catch {}
    }
  }
  return true
}

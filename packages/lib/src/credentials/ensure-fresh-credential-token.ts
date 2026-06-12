// packages/lib/src/credentials/ensure-fresh-credential-token.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

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
 * If the credential's access token is expired or within the refresh-ahead window of expiry and a
 * refresh token exists, refresh it — single-flight per credential via a Redis NX lock (refresh
 * tokens may rotate; concurrent refreshes would persist a dead rotation). Kind-agnostic: routes
 * through `refreshCredentialTokens`, which branches on `record.kind` (`mcp` / `app`) itself.
 * Returns `true` when the stored secrets may have changed (a refresh ran here, or another process
 * held the lock) so the caller knows to re-reveal; `false` means the token was fresh and nothing
 * happened. Never throws: a failed refresh leaves the stored token in place for the caller's 401
 * path, and `refreshCredentialTokens` already stamps the breaker.
 */
export async function ensureFreshCredentialToken(input: {
  credentialId: string
  organizationId: string
  expiresAt?: Date | null
  lastRefreshAt?: Date | null
  createdAt?: Date
  hasRefreshToken: boolean
  /** Skip the expiry check — used by the 401 retry path where the token just failed live. */
  force?: boolean
}): Promise<boolean> {
  const { credentialId, organizationId, expiresAt, hasRefreshToken, force } = input

  if (!hasRefreshToken) return false
  if (!force) {
    if (!expiresAt) return false // can't tell — leave it to the 401 path
    const skew = expirySkewMs({
      expiresAt,
      lastRefreshAt: input.lastRefreshAt,
      createdAt: input.createdAt,
    })
    if (expiresAt.getTime() - Date.now() > skew) return false
  }

  let redis: Awaited<ReturnType<typeof getRedisClient>> | null = null
  try {
    redis = await getRedisClient(false)
  } catch {
    // Redis unavailable → refresh without the lock; correctness beats stampede protection.
  }

  if (redis) {
    try {
      const acquired = await redis.set(lockKey(credentialId), '1', 'EX', LOCK_TTL_SECONDS, 'NX')
      if (!acquired) {
        // Someone else is refreshing — wait for the lock to clear, then let the caller re-read
        // whatever the winner persisted. Never fail the call over lock contention.
        for (let i = 0; i < LOCK_POLLS; i++) {
          await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS))
          if (!(await redis.get(lockKey(credentialId)))) break
        }
        return true
      }
    } catch {
      redis = null // lock machinery failed — refresh anyway
    }
  }

  try {
    // Lazy import: oauth2-workflow pulls in the heavy workflow-nodes/services graph, which a
    // low-level credentials module must not load statically (breaks test mock interception too).
    const { refreshCredentialTokens } = await import('../workflows/oauth2-workflow')
    const result = await refreshCredentialTokens(credentialId, organizationId)
    if (!result.success) {
      logger.warn('Credential token refresh failed', { credentialId, error: result.error })
    }
  } catch (error) {
    logger.warn('Credential token refresh threw', {
      credentialId,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (redis) {
      try {
        await redis.del(lockKey(credentialId))
      } catch {}
    }
  }
  return true
}

// packages/redis/src/credential-lock.ts

import type { CredentialLockProvider } from '@auxx/credentials/connections'
import { getRedisClient } from './client'

/**
 * Redis-backed {@link CredentialLockProvider} — the single-flight lock behind
 * `ensureFreshCredentialToken`.
 *
 * The implementation lives here rather than in `@auxx/credentials` because that package sits
 * *below* this one in the dependency graph (redis imports `configService` from it), so credentials
 * declares the interface and this package supplies the implementation.
 *
 * Every method throws when Redis is unavailable. That is deliberate: `ensureFreshCredentialToken`
 * treats a throwing provider as "no lock available" and refreshes unserialised, which is exactly
 * the behaviour we want when Redis is down — correctness beats stampede protection. Returning
 * `false` from `acquire` instead would be read as "another holder is refreshing" and would skip
 * the refresh entirely.
 */
export function createCredentialLockProvider(): CredentialLockProvider {
  const client = async () => {
    const redis = await getRedisClient(false)
    if (!redis) throw new Error('Redis unavailable')
    return redis
  }

  return {
    async acquire(key: string, ttlSeconds: number): Promise<boolean> {
      const redis = await client()
      return !!(await redis.set(key, '1', 'EX', ttlSeconds, 'NX'))
    },
    async isHeld(key: string): Promise<boolean> {
      const redis = await client()
      return !!(await redis.get(key))
    },
    async release(key: string): Promise<void> {
      const redis = await client()
      await redis.del(key)
    },
  }
}

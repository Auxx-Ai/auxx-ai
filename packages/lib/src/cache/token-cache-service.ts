// packages/lib/src/cache/token-cache-service.ts

import { BaseCacheService } from './base-cache-service'

const DEFAULT_TTL = 600 // 10 minutes

/**
 * Cache service for short-lived, one-time-use tokens (CSRF, verification codes, magic links).
 * Extends BaseCacheService for Redis connection management and graceful fallback.
 */
export class TokenCacheService extends BaseCacheService {
  constructor() {
    super('token', DEFAULT_TTL)
  }

  /** Store a token with an optional TTL override (in seconds). */
  async store(key: string, value: string, ttl?: number): Promise<void> {
    await this.set(key, value, { ttl })
  }

  /** Retrieve and delete a token (one-time use). Returns null if missing or expired. */
  async consume(key: string): Promise<string | null> {
    const value = await this.get<string>(key)
    if (value !== null) {
      await this.delete(key)
    }
    return value
  }
}

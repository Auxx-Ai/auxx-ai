// packages/lib/src/utils/rate-limiter/redis-rate-limiter.ts

import { createScopedLogger } from '../../logger'
import { getRedisClient, getRedisProvider, type RedisClient } from '@auxx/redis'
import type { RateLimiter, RateLimiterConfig } from './types'
import { TokenBucket } from './token-bucket'

/** Default timeout for Redis operations in milliseconds */
const REDIS_OPERATION_TIMEOUT_MS = 5000

/**
 * Redis-aware rate limiter with multi-provider support
 * Falls back to in-memory rate limiting if Redis is unavailable
 */
export class RedisRateLimiter implements RateLimiter {
  private redis: RedisClient | undefined = undefined
  private localFallback: Map<string, TokenBucket> = new Map()
  private provider: 'upstash' | 'aws' | 'hosted' = 'hosted'
  private initialized = false
  private logger = createScopedLogger('RedisRateLimiter')

  /**
   * Create a new Redis-aware rate limiter
   * @param config - Rate limiter configuration
   */
  constructor(private config: RateLimiterConfig) {}

  /**
   * Initialize the rate limiter
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      this.redis = await getRedisClient(false)
      this.provider = getRedisProvider()

      if (!this.redis) {
        this.logger.warn('Redis unavailable, using in-memory rate limiting', {
          context: this.config.name,
        })
      } else {
        this.logger.info('Redis rate limiter initialized', {
          provider: this.provider,
          context: this.config.name,
        })
      }
    } catch (error) {
      this.logger.error('Failed to initialize Redis for rate limiting', {
        error,
        context: this.config.name,
      })
      // Fallback to in-memory
      this.redis = undefined
    }

    this.initialized = true
  }

  /**
   * Wrap a promise with a timeout
   * @param promise - Promise to wrap
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise that rejects if timeout is exceeded
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number = REDIS_OPERATION_TIMEOUT_MS): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Redis operation timed out after ${timeoutMs}ms`)), timeoutMs)
    })

    try {
      const result = await Promise.race([promise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  /**
   * Acquire tokens from the rate limiter
   * @param key - Rate limit key
   * @param tokens - Number of tokens to acquire
   * @returns true if tokens were acquired
   */
  async acquire(key: string, tokens: number = 1): Promise<boolean> {
    // Ensure we're initialized
    if (!this.initialized) {
      await this.init()
    }

    // Try Redis first
    if (this.redis) {
      try {
        return await this.acquireFromRedis(key, tokens)
      } catch (error) {
        this.logger.warn('Redis rate limit failed, falling back to memory', {
          error: error instanceof Error ? error.message : error,
          key,
          context: this.config.name,
        })
        // Fall through to in-memory implementation
      }
    }

    // Fallback to in-memory
    return this.acquireLocal(key, tokens)
  }

  /**
   * Acquire tokens from Redis using simple get/set operations
   * @param key - Rate limit key
   * @param tokens - Number of tokens to acquire
   * @returns true if tokens were acquired
   */
  private async acquireFromRedis(key: string, tokens: number): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Redis client not initialized')
    }

    const now = Date.now()
    const fullKey = `ratelimit:${key}`
    const capacity = this.config.maxRequests
    const refillRate = this.config.maxRequests / this.config.perInterval // tokens per ms
    const ttl = Math.ceil(this.config.perInterval / 1000) + 60 // TTL in seconds with buffer

    // Get current bucket state with timeout
    const [storedTokens, lastRefill] = await this.withTimeout(
      Promise.all([
        this.redis.get(`${fullKey}:tokens`),
        this.redis.get(`${fullKey}:lastRefill`),
      ])
    )

    let currentTokens = storedTokens ? parseFloat(storedTokens as string) : capacity
    const lastRefillTime = lastRefill ? parseInt(lastRefill as string, 10) : now

    // Calculate refill based on elapsed time
    const elapsed = Math.max(0, now - lastRefillTime)
    const tokensToAdd = elapsed * refillRate
    currentTokens = Math.min(capacity, currentTokens + tokensToAdd)

    // Check if we have enough tokens
    if (currentTokens >= tokens) {
      currentTokens -= tokens

      // Update state with timeout
      await this.withTimeout(
        Promise.all([
          this.redis.setex(`${fullKey}:tokens`, ttl, currentTokens.toString()),
          this.redis.setex(`${fullKey}:lastRefill`, ttl, now.toString()),
        ])
      )

      return true
    } else {
      // Update refill time even if we can't acquire tokens
      await this.withTimeout(
        Promise.all([
          this.redis.setex(`${fullKey}:tokens`, ttl, currentTokens.toString()),
          this.redis.setex(`${fullKey}:lastRefill`, ttl, now.toString()),
        ])
      )

      return false
    }
  }

  /**
   * Acquire tokens using local in-memory fallback
   * @param key - Rate limit key
   * @param tokens - Number of tokens to acquire
   * @returns true if tokens were acquired
   */
  private acquireLocal(key: string, tokens: number): boolean {
    const fullKey = `local:${key}`

    if (!this.localFallback.has(fullKey)) {
      const refillRate = this.config.maxRequests / this.config.perInterval
      this.localFallback.set(fullKey, new TokenBucket(this.config.maxRequests, refillRate))
    }

    return this.localFallback.get(fullKey)!.tryAcquire(tokens)
  }

  /**
   * Get available tokens for a key
   * @param key - Rate limit key
   * @returns Number of available tokens
   */
  async getAvailableTokens(key: string): Promise<number> {
    if (!this.initialized) {
      await this.init()
    }

    if (this.redis) {
      try {
        const fullKey = `ratelimit:${key}`

        const [storedTokens, lastRefill] = await this.withTimeout(
          Promise.all([
            this.redis.get(`${fullKey}:tokens`),
            this.redis.get(`${fullKey}:lastRefill`),
          ])
        )

        if (storedTokens && lastRefill) {
          const currentTokens = parseFloat(storedTokens as string)
          const lastRefillTime = parseInt(lastRefill as string, 10)
          const now = Date.now()
          const elapsed = Math.max(0, now - lastRefillTime)
          const refillRate = this.config.maxRequests / this.config.perInterval
          const tokensToAdd = elapsed * refillRate
          return Math.min(this.config.maxRequests, currentTokens + tokensToAdd)
        }
        return this.config.maxRequests
      } catch (error) {
        this.logger.warn('Failed to get available tokens from Redis', {
          error: error instanceof Error ? error.message : error,
          key,
        })
        // Fall through to local
      }
    }

    // Local fallback
    const fullKey = `local:${key}`
    if (this.localFallback.has(fullKey)) {
      return this.localFallback.get(fullKey)!.getAvailableTokens()
    }
    return this.config.maxRequests
  }

  /**
   * Reset the rate limiter for a specific key
   * @param key - Rate limit key
   */
  async reset(key: string): Promise<void> {
    if (!this.initialized) {
      await this.init()
    }

    if (this.redis) {
      try {
        const fullKey = `ratelimit:${key}`
        await this.withTimeout(
          Promise.all([
            this.redis.del(`${fullKey}:tokens`),
            this.redis.del(`${fullKey}:lastRefill`),
          ])
        )
      } catch (error) {
        this.logger.warn('Failed to reset rate limiter in Redis', {
          error: error instanceof Error ? error.message : error,
          key,
        })
      }
    }

    // Also reset local fallback
    const fullKey = `local:${key}`
    if (this.localFallback.has(fullKey)) {
      this.localFallback.get(fullKey)!.reset()
    }
  }

  /**
   * Check if Redis is available
   * @returns true if Redis is connected
   */
  isRedisAvailable(): boolean {
    return this.redis !== undefined
  }

  /**
   * Cleanup old local buckets to prevent memory leaks
   */
  cleanupLocalBuckets(): void {
    // Remove buckets if we have too many (simple memory management)
    if (this.localFallback.size > 1000) {
      // Keep the most recent half
      const entries = Array.from(this.localFallback.entries())
      const toKeep = entries.slice(-500)
      this.localFallback.clear()
      for (const [key, bucket] of toKeep) {
        this.localFallback.set(key, bucket)
      }
    }
  }

  /**
   * Get statistics about the rate limiter
   */
  getStats(): {
    provider: string
    redisConnected: boolean
    localBuckets: number
  } {
    return {
      provider: this.provider,
      redisConnected: this.redis !== undefined,
      localBuckets: this.localFallback.size,
    }
  }
}

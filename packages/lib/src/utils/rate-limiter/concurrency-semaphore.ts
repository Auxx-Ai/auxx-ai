// packages/lib/src/utils/rate-limiter/concurrency-semaphore.ts

import { getRedisClient, type RedisClient } from '@auxx/redis'
import { createScopedLogger } from '../../logger'

/** Default timeout for Redis operations in milliseconds */
const REDIS_OPERATION_TIMEOUT_MS = 5000

/** TTL for Redis keys in seconds (cleanup stale entries) */
const REDIS_KEY_TTL_SECONDS = 300

/**
 * Waiter in the queue waiting for a semaphore slot
 */
interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: NodeJS.Timeout
}

/**
 * Semaphore for limiting concurrent requests
 * Supports both in-memory and Redis-based tracking for distributed systems
 */
export class ConcurrencySemaphore {
  private redis: RedisClient | undefined = undefined
  private localCounts: Map<string, number> = new Map()
  private waiters: Map<string, Waiter[]> = new Map()
  private initialized = false
  private logger = createScopedLogger('ConcurrencySemaphore')

  constructor(private useRedis: boolean = true) {}

  /**
   * Initialize the semaphore (connect to Redis if enabled)
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    if (this.useRedis) {
      try {
        this.redis = await getRedisClient(false)
        if (this.redis) {
          this.logger.info('ConcurrencySemaphore initialized with Redis')
        } else {
          this.logger.warn('Redis unavailable, using in-memory concurrency tracking')
        }
      } catch (error) {
        this.logger.error('Failed to initialize Redis for concurrency semaphore', { error })
        this.redis = undefined
      }
    }

    this.initialized = true
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = REDIS_OPERATION_TIMEOUT_MS
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Redis operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
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
   * Try to acquire a slot in the semaphore
   * @param key - Unique key for the resource
   * @param maxConcurrent - Maximum concurrent requests allowed
   * @returns true if slot was acquired, false otherwise
   */
  async tryAcquire(key: string, maxConcurrent: number): Promise<boolean> {
    if (!this.initialized) {
      await this.init()
    }

    if (this.redis) {
      try {
        return await this.tryAcquireRedis(key, maxConcurrent)
      } catch (error) {
        this.logger.warn('Redis semaphore acquire failed, falling back to memory', {
          error: error instanceof Error ? error.message : error,
          key,
        })
      }
    }

    return this.tryAcquireLocal(key, maxConcurrent)
  }

  /**
   * Acquire a slot, waiting if necessary
   * @param key - Unique key for the resource
   * @param maxConcurrent - Maximum concurrent requests allowed
   * @param timeoutMs - Maximum time to wait for a slot
   * @returns true if slot was acquired
   * @throws Error if timeout is exceeded
   */
  async acquire(key: string, maxConcurrent: number, timeoutMs: number = 30000): Promise<boolean> {
    // First try immediate acquisition
    const acquired = await this.tryAcquire(key, maxConcurrent)
    if (acquired) {
      return true
    }

    // Wait for a slot to become available
    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from waiters
        const keyWaiters = this.waiters.get(key)
        if (keyWaiters) {
          const index = keyWaiters.findIndex((w) => w.timeoutId === timeoutId)
          if (index !== -1) {
            keyWaiters.splice(index, 1)
          }
        }
        reject(new Error(`Concurrency semaphore timeout waiting for slot on key: ${key}`))
      }, timeoutMs)

      const waiter: Waiter = {
        resolve: () => {
          clearTimeout(timeoutId)
          resolve(true)
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
        timeoutId,
      }

      if (!this.waiters.has(key)) {
        this.waiters.set(key, [])
      }
      this.waiters.get(key)!.push(waiter)

      this.logger.debug('Request queued for concurrency slot', {
        key,
        waitersCount: this.waiters.get(key)!.length,
      })
    })
  }

  /**
   * Release a slot in the semaphore
   * @param key - Unique key for the resource
   */
  async release(key: string): Promise<void> {
    if (!this.initialized) {
      return
    }

    if (this.redis) {
      try {
        await this.releaseRedis(key)
      } catch (error) {
        this.logger.warn('Redis semaphore release failed, falling back to memory', {
          error: error instanceof Error ? error.message : error,
          key,
        })
        this.releaseLocal(key)
      }
    } else {
      this.releaseLocal(key)
    }

    // Notify any waiters
    await this.notifyWaiters(key)
  }

  /**
   * Get current count for a key
   * @param key - Unique key for the resource
   * @returns Current number of acquired slots
   */
  async getCount(key: string): Promise<number> {
    if (!this.initialized) {
      await this.init()
    }

    if (this.redis) {
      try {
        return await this.getCountRedis(key)
      } catch (error) {
        this.logger.warn('Redis semaphore getCount failed', {
          error: error instanceof Error ? error.message : error,
          key,
        })
      }
    }

    return this.localCounts.get(key) || 0
  }

  /**
   * Try to acquire using Redis
   */
  private async tryAcquireRedis(key: string, maxConcurrent: number): Promise<boolean> {
    if (!this.redis) {
      throw new Error('Redis client not initialized')
    }

    const redisKey = `concurrency:${key}`

    // Increment and check atomically
    const newCount = (await this.withTimeout(this.redis.incr(redisKey))) as number

    // Set TTL on the key (cleanup stale entries)
    await this.withTimeout(this.redis.expire(redisKey, REDIS_KEY_TTL_SECONDS))

    if (newCount <= maxConcurrent) {
      this.logger.debug('Acquired concurrency slot (Redis)', {
        key,
        currentCount: newCount,
        maxConcurrent,
      })
      return true
    }

    // We exceeded the limit, decrement back
    await this.withTimeout(this.redis.decr(redisKey))
    this.logger.debug('Concurrency limit reached (Redis)', {
      key,
      currentCount: newCount - 1,
      maxConcurrent,
    })
    return false
  }

  /**
   * Release using Redis
   */
  private async releaseRedis(key: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not initialized')
    }

    const redisKey = `concurrency:${key}`
    const newCount = (await this.withTimeout(this.redis.decr(redisKey))) as number

    // Don't let count go negative
    if (newCount < 0) {
      await this.withTimeout(this.redis.set(redisKey, '0'))
    }

    this.logger.debug('Released concurrency slot (Redis)', {
      key,
      currentCount: Math.max(0, newCount),
    })
  }

  /**
   * Get count from Redis
   */
  private async getCountRedis(key: string): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client not initialized')
    }

    const redisKey = `concurrency:${key}`
    const count = await this.withTimeout(this.redis.get(redisKey))
    return count ? parseInt(count as string, 10) : 0
  }

  /**
   * Try to acquire using local memory
   */
  private tryAcquireLocal(key: string, maxConcurrent: number): boolean {
    const currentCount = this.localCounts.get(key) || 0

    if (currentCount < maxConcurrent) {
      this.localCounts.set(key, currentCount + 1)
      this.logger.debug('Acquired concurrency slot (local)', {
        key,
        currentCount: currentCount + 1,
        maxConcurrent,
      })
      return true
    }

    this.logger.debug('Concurrency limit reached (local)', {
      key,
      currentCount,
      maxConcurrent,
    })
    return false
  }

  /**
   * Release using local memory
   */
  private releaseLocal(key: string): void {
    const currentCount = this.localCounts.get(key) || 0
    const newCount = Math.max(0, currentCount - 1)

    if (newCount === 0) {
      this.localCounts.delete(key)
    } else {
      this.localCounts.set(key, newCount)
    }

    this.logger.debug('Released concurrency slot (local)', { key, currentCount: newCount })
  }

  /**
   * Notify waiters that a slot may be available
   */
  private async notifyWaiters(key: string): Promise<void> {
    const keyWaiters = this.waiters.get(key)
    if (!keyWaiters || keyWaiters.length === 0) {
      return
    }

    // Try to give the slot to the first waiter
    const waiter = keyWaiters.shift()
    if (waiter) {
      // The waiter will try to acquire when resolved
      // We use setImmediate to avoid stack overflow with many waiters
      setImmediate(() => {
        waiter.resolve()
      })
    }

    // Clean up empty waiter lists
    if (keyWaiters.length === 0) {
      this.waiters.delete(key)
    }
  }

  /**
   * Get statistics about the semaphore
   */
  getStats(): { localKeys: number; totalWaiters: number; keys: Record<string, number> } {
    const keys: Record<string, number> = {}
    for (const [key, count] of Array.from(this.localCounts.entries())) {
      keys[key] = count
    }

    let totalWaiters = 0
    for (const waiters of Array.from(this.waiters.values())) {
      totalWaiters += waiters.length
    }

    return {
      localKeys: this.localCounts.size,
      totalWaiters,
      keys,
    }
  }

  /**
   * Reset a specific key
   */
  async reset(key: string): Promise<void> {
    if (this.redis) {
      try {
        const redisKey = `concurrency:${key}`
        await this.withTimeout(this.redis.del(redisKey))
      } catch (error) {
        this.logger.warn('Failed to reset Redis concurrency key', {
          error: error instanceof Error ? error.message : error,
          key,
        })
      }
    }

    this.localCounts.delete(key)

    // Reject all waiters for this key
    const keyWaiters = this.waiters.get(key)
    if (keyWaiters) {
      for (const waiter of keyWaiters) {
        waiter.reject(new Error('Semaphore reset'))
      }
      this.waiters.delete(key)
    }
  }

  /**
   * Shutdown the semaphore
   */
  async shutdown(): Promise<void> {
    // Reject all waiters
    for (const [, keyWaiters] of Array.from(this.waiters.entries())) {
      for (const waiter of keyWaiters) {
        waiter.reject(new Error('Semaphore shutdown'))
      }
    }
    this.waiters.clear()
    this.localCounts.clear()
    this.initialized = false
  }
}

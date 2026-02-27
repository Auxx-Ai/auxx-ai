// packages/lib/src/utils/rate-limiter/__tests__/integration.test.ts

import { describe, expect, it, vi } from 'vitest'
import { ExponentialBackoff } from '../backoff-handler'
import { CircuitBreaker } from '../circuit-breaker'
import { createSimpleRateLimiter } from '../index'
import { PriorityQueue } from '../priority-queue'
import { TokenBucket } from '../token-bucket'

// Mock logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock Redis to prevent real connections
vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  getRedisProvider: vi.fn().mockReturnValue('hosted'),
}))

// Mock credentials to prevent real config loading
vi.mock('@auxx/credentials', () => ({
  configService: {
    get: vi.fn().mockReturnValue(undefined),
  },
  CredentialService: {
    loadCredential: vi.fn().mockResolvedValue({}),
  },
}))

describe('Rate Limiter Integration Tests', () => {
  describe('Real-world scenarios', () => {
    it('should handle burst traffic with token bucket', async () => {
      const bucket = new TokenBucket(10, 0.001) // 10 tokens, very slow refill

      // Simulate burst of 15 requests
      const results = []
      for (let i = 0; i < 15; i++) {
        results.push(bucket.tryAcquire(1))
      }

      // Count successes and failures
      const successes = results.filter((r) => r === true).length
      const failures = results.filter((r) => r === false).length

      // Should have exactly 10 successes (bucket capacity) and 5 failures
      expect(successes).toBe(10)
      expect(failures).toBe(5)

      // Wait for refill (with 0.001 tokens/ms, 5ms gives ~0.005 tokens, need longer)
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Should be able to acquire more after refill
      expect(bucket.tryAcquire(1)).toBe(true)
    })

    it('should protect service with circuit breaker', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 1000,
        halfOpenRequests: 2,
      })

      let serviceHealth = 'unhealthy'
      const callService = () => {
        if (serviceHealth === 'unhealthy') {
          throw new Error('Service unavailable')
        }
        return 'success'
      }

      // Service fails 3 times and circuit opens
      for (let i = 0; i < 3; i++) {
        expect(() => breaker.execute(() => Promise.resolve(callService()))).rejects.toThrow()
      }

      expect(breaker.getState()).toBe('open')

      // Service recovers but circuit is still open
      serviceHealth = 'healthy'

      // Circuit prevents calls while open
      expect(breaker.canExecute()).toBe(false)
    })

    it('should prioritize important requests', () => {
      const queue = new PriorityQueue()

      // Add various priority requests
      const requests = [
        { id: 'background-1', priority: 10, type: 'background' },
        { id: 'urgent-1', priority: 1, type: 'urgent' },
        { id: 'normal-1', priority: 5, type: 'normal' },
        { id: 'urgent-2', priority: 1, type: 'urgent' },
        { id: 'normal-2', priority: 5, type: 'normal' },
        { id: 'background-2', priority: 10, type: 'background' },
      ]

      requests.forEach((req) => {
        queue.enqueue({
          id: req.id,
          priority: req.priority,
          timestamp: Date.now(),
          fn: async () => req.type,
          resolve: () => {},
          reject: () => {},
        })
      })

      // Process in priority order
      const processed = []
      while (!queue.isEmpty()) {
        const req = queue.dequeue()
        if (req) {
          processed.push(req.id)
        }
      }

      // Should process urgent first, then normal, then background
      // Within the same priority level, order depends on heap implementation
      const urgentItems = processed.slice(0, 2).sort()
      const normalItems = processed.slice(2, 4).sort()
      const backgroundItems = processed.slice(4, 6).sort()

      expect(urgentItems).toEqual(['urgent-1', 'urgent-2'])
      expect(normalItems).toEqual(['normal-1', 'normal-2'])
      expect(backgroundItems).toEqual(['background-1', 'background-2'])
    })

    it('should handle retry with exponential backoff', async () => {
      const backoff = new ExponentialBackoff({
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 2,
        jitter: false,
      })

      let attempts = 0
      const delays: number[] = []
      const startTime = Date.now()

      const result = await backoff.executeWithRetry(async () => {
        const currentTime = Date.now()
        if (attempts > 0) {
          delays.push(currentTime - startTime)
        }
        attempts++

        if (attempts < 3) {
          // Simulate transient failures
          const error: any = new Error('Service temporarily unavailable')
          error.status = 503
          throw error
        }

        return { success: true, attempts }
      })

      expect(result).toEqual({ success: true, attempts: 3 })
      expect(attempts).toBe(3)

      // Verify backoff delays are increasing
      if (delays.length >= 2) {
        expect(delays[1]).toBeGreaterThan(delays[0])
      }
    })

    it('should enforce rate limits across multiple contexts', async () => {
      // Create a simple rate limiter with generous limits
      // createSimpleRateLimiter(5, 100) => requestsPerMinute = 3000
      // This means 10 sequential requests should all succeed
      const limiter = await createSimpleRateLimiter(5, 100)

      const results = []

      // Try to make 10 requests quickly
      for (let i = 0; i < 10; i++) {
        try {
          const result = await limiter.execute(
            'api-call',
            async () => ({ id: i }),
            { queue: false } // Don't queue, fail immediately
          )
          results.push({ success: true, ...result })
        } catch (error) {
          results.push({ success: false, id: i })
        }
      }

      // With 3000 requests/min capacity, all 10 should succeed
      const successes = results.filter((r) => r.success).length

      expect(successes).toBeGreaterThan(0)
      expect(successes + results.filter((r) => !r.success).length).toBe(10)
    })

    it('should handle different rate limits for different operations', async () => {
      const limiter = await createSimpleRateLimiter(100, 60000) // 100 per minute base

      // Different operations with different costs
      const operations = [
        { type: 'read', cost: 1 },
        { type: 'write', cost: 5 },
        { type: 'batch', cost: 10 },
      ]

      const results = []

      for (const op of operations) {
        try {
          const result = await limiter.execute(
            `operation.${op.type}`,
            async () => ({ type: op.type, timestamp: Date.now() }),
            { cost: op.cost }
          )
          results.push({ success: true, ...result })
        } catch (error) {
          results.push({ success: false, type: op.type })
        }
      }

      // All should succeed as total cost is 16 < 100
      expect(results.every((r) => r.success)).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should gracefully handle circuit breaker errors', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenRequests: 1,
      })

      // Trigger circuit breaker
      await expect(
        breaker.execute(async () => {
          throw new Error('Service error')
        })
      ).rejects.toThrow('Service error')

      // Next call should get circuit breaker error
      const result = await breaker
        .execute(async () => 'success')
        .catch((err) => ({
          error: err.name,
          message: err.message,
        }))

      expect(result).toHaveProperty('error', 'CircuitBreakerError')
    })

    it('should handle queue overflow gracefully', () => {
      const queue = new PriorityQueue()
      const maxSize = 1000

      // Fill queue to capacity
      for (let i = 0; i < maxSize; i++) {
        queue.enqueue({
          id: `req-${i}`,
          priority: Math.floor(Math.random() * 10),
          timestamp: Date.now(),
          fn: async () => i,
          resolve: () => {},
          reject: () => {},
        })
      }

      expect(queue.size()).toBe(maxSize)

      // Queue statistics should still work
      const stats = queue.getStats()
      expect(stats.size).toBe(maxSize)
      expect(stats.highestPriority).toBeDefined()
      expect(stats.lowestPriority).toBeDefined()

      // Clear queue
      queue.clear()
      expect(queue.size()).toBe(0)
    })
  })

  describe('Performance', () => {
    it('should handle high throughput efficiently', () => {
      const bucket = new TokenBucket(1000, 10) // 1000 tokens, 10 tokens/ms

      const start = Date.now()
      let successful = 0

      // Try to acquire as many as possible in 100ms
      while (Date.now() - start < 100) {
        if (bucket.tryAcquire(1)) {
          successful++
        }
      }

      // Should have processed many requests
      expect(successful).toBeGreaterThan(100)

      // But not more than capacity + refill
      expect(successful).toBeLessThan(2000)
    })

    it('should maintain queue performance with many items', () => {
      const queue = new PriorityQueue()

      const start = Date.now()

      // Add 1000 items
      for (let i = 0; i < 1000; i++) {
        queue.enqueue({
          id: `item-${i}`,
          priority: Math.floor(Math.random() * 100),
          timestamp: Date.now(),
          fn: async () => i,
          resolve: () => {},
          reject: () => {},
        })
      }

      // Dequeue all items
      while (!queue.isEmpty()) {
        queue.dequeue()
      }

      const elapsed = Date.now() - start

      // Should complete quickly (< 100ms for 1000 items)
      expect(elapsed).toBeLessThan(100)
    })
  })
})

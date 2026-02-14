// packages/lib/src/utils/rate-limiter/__tests__/rate-limiter.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExponentialBackoff } from '../backoff-handler'
import { CircuitBreaker } from '../circuit-breaker'
import { MetricsCollector } from '../metrics-collector'
import { PriorityQueue } from '../priority-queue'
import { TokenBucket } from '../token-bucket'
import { CircuitBreakerError, RateLimitError } from '../types'
import { UniversalThrottler } from '../universal-throttler'

describe('TokenBucket', () => {
  it('should initialize with full capacity', () => {
    const bucket = new TokenBucket(10, 0.1) // 10 tokens, 0.1 token/ms
    expect(bucket.getAvailableTokens()).toBe(10)
  })

  it('should consume tokens when acquiring', () => {
    const bucket = new TokenBucket(10, 0.1)
    const acquired = bucket.tryAcquire(5)

    expect(acquired).toBe(true)
    expect(bucket.getAvailableTokens()).toBe(5)
  })

  it('should reject when not enough tokens', () => {
    const bucket = new TokenBucket(5, 0.1)
    const acquired = bucket.tryAcquire(10)

    expect(acquired).toBe(false)
    expect(bucket.getAvailableTokens()).toBe(5)
  })

  it('should refill tokens over time', async () => {
    const bucket = new TokenBucket(10, 1) // 1 token per ms
    bucket.tryAcquire(10) // Empty the bucket

    await new Promise((resolve) => setTimeout(resolve, 5))

    const available = bucket.getAvailableTokens()
    expect(available).toBeGreaterThan(0)
    expect(available).toBeLessThanOrEqual(10)
  })

  it('should not exceed capacity when refilling', async () => {
    const bucket = new TokenBucket(10, 10) // Fast refill rate

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(bucket.getAvailableTokens()).toBe(10)
  })

  it('should calculate wait time correctly', () => {
    const bucket = new TokenBucket(10, 0.1) // 0.1 token/ms
    bucket.tryAcquire(10) // Empty the bucket

    const waitTime = bucket.getWaitTime(5) // Need 5 tokens
    expect(waitTime).toBe(50) // 5 tokens / 0.1 token per ms = 50ms
  })

  it('should reset to full capacity', () => {
    const bucket = new TokenBucket(10, 0.1)
    bucket.tryAcquire(5)

    bucket.reset()
    expect(bucket.getAvailableTokens()).toBe(10)
  })
})

describe('ExponentialBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry on retryable errors', async () => {
    const backoff = new ExponentialBackoff({
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
      jitter: false,
    })

    let attempts = 0
    const fn = vi.fn(async () => {
      attempts++
      if (attempts < 3) {
        throw new Error('rate limit')
      }
      return 'success'
    })

    const promise = backoff.executeWithRetry(fn)

    // Wait for retries to complete
    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should not retry on non-retryable errors', async () => {
    const backoff = new ExponentialBackoff({
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
    })

    const fn = vi.fn(async () => {
      throw new Error('not retryable')
    })

    await expect(backoff.executeWithRetry(fn)).rejects.toThrow('not retryable')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should respect max retries', async () => {
    const backoff = new ExponentialBackoff({
      maxRetries: 2,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
      jitter: false,
    })

    const fn = vi.fn(async () => {
      throw new Error('rate limit')
    })

    const promise = backoff.executeWithRetry(fn)

    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow(/Max retries \(2\) exceeded/)
    expect(fn).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  it('should detect rate limit errors by status code', async () => {
    const backoff = new ExponentialBackoff({
      maxRetries: 1,
      initialDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
    })

    let attempts = 0
    const fn = vi.fn(async () => {
      attempts++
      if (attempts === 1) {
        const error: any = new Error('Too Many Requests')
        error.status = 429
        throw error
      }
      return 'success'
    })

    const promise = backoff.executeWithRetry(fn)
    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start in closed state', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenRequests: 2,
    })

    expect(breaker.getState()).toBe('closed')
  })

  it('should open after failure threshold', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenRequests: 2,
    })

    const fn = vi.fn(async () => {
      throw new Error('failure')
    })

    // Trigger failures
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('failure')
    }

    expect(breaker.getState()).toBe('open')

    // Should reject immediately when open
    await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError)
    expect(fn).toHaveBeenCalledTimes(3) // No additional call
  })

  it('should enter half-open state after timeout', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 1000,
      halfOpenRequests: 2,
    })

    const fn = vi.fn(async () => {
      throw new Error('failure')
    })

    // Open the breaker
    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow()
    }

    expect(breaker.getState()).toBe('open')

    // Wait for reset timeout
    await vi.advanceTimersByTimeAsync(1000)

    // Should be half-open now
    const successFn = vi.fn(async () => 'success')
    const result = await breaker.execute(successFn)

    expect(result).toBe('success')
    expect(breaker.getState()).toBe('half-open')
  })

  it('should close after successful half-open requests', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 1000,
      halfOpenRequests: 2,
    })

    // Open the breaker
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error('failure')
        })
      ).rejects.toThrow()
    }

    // Wait and enter half-open
    await vi.advanceTimersByTimeAsync(1000)

    // Successful requests in half-open state
    for (let i = 0; i < 2; i++) {
      await breaker.execute(async () => 'success')
    }

    expect(breaker.getState()).toBe('closed')
  })

  it('should track stats correctly', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenRequests: 2,
    })

    await breaker.execute(async () => 'success')
    await expect(
      breaker.execute(async () => {
        throw new Error('failure')
      })
    ).rejects.toThrow()

    const stats = breaker.getStats()
    expect(stats.failures).toBe(1)
    expect(stats.state).toBe('closed')
  })
})

describe('PriorityQueue', () => {
  it('should dequeue items by priority', () => {
    const queue = new PriorityQueue()

    queue.enqueue({
      id: '1',
      priority: 5,
      timestamp: Date.now(),
      fn: async () => 'low',
      resolve: () => {},
      reject: () => {},
    })

    queue.enqueue({
      id: '2',
      priority: 1,
      timestamp: Date.now(),
      fn: async () => 'high',
      resolve: () => {},
      reject: () => {},
    })

    queue.enqueue({
      id: '3',
      priority: 3,
      timestamp: Date.now(),
      fn: async () => 'medium',
      resolve: () => {},
      reject: () => {},
    })

    const first = queue.dequeue()
    const second = queue.dequeue()
    const third = queue.dequeue()

    expect(first?.priority).toBe(1) // Highest priority (lowest number)
    expect(second?.priority).toBe(3)
    expect(third?.priority).toBe(5)
  })

  it('should use FIFO for same priority', () => {
    const queue = new PriorityQueue()
    const now = Date.now()

    queue.enqueue({
      id: '1',
      priority: 5,
      timestamp: now,
      fn: async () => 'first',
      resolve: () => {},
      reject: () => {},
    })

    queue.enqueue({
      id: '2',
      priority: 5,
      timestamp: now + 1,
      fn: async () => 'second',
      resolve: () => {},
      reject: () => {},
    })

    const first = queue.dequeue()
    const second = queue.dequeue()

    expect(first?.id).toBe('1')
    expect(second?.id).toBe('2')
  })

  it('should track queue size', () => {
    const queue = new PriorityQueue()

    expect(queue.size()).toBe(0)
    expect(queue.isEmpty()).toBe(true)

    queue.enqueue({
      id: '1',
      priority: 1,
      timestamp: Date.now(),
      fn: async () => 'test',
      resolve: () => {},
      reject: () => {},
    })

    expect(queue.size()).toBe(1)
    expect(queue.isEmpty()).toBe(false)

    queue.dequeue()
    expect(queue.size()).toBe(0)
    expect(queue.isEmpty()).toBe(true)
  })

  it('should remove items by id', () => {
    const queue = new PriorityQueue()

    queue.enqueue({
      id: 'remove-me',
      priority: 1,
      timestamp: Date.now(),
      fn: async () => 'test',
      resolve: () => {},
      reject: vi.fn(),
    })

    queue.enqueue({
      id: 'keep-me',
      priority: 2,
      timestamp: Date.now(),
      fn: async () => 'test',
      resolve: () => {},
      reject: () => {},
    })

    const removed = queue.remove('remove-me')
    expect(removed).toBe(true)
    expect(queue.size()).toBe(1)
    expect(queue.peek()?.id).toBe('keep-me')
  })

  it('should update priority correctly', () => {
    const queue = new PriorityQueue()

    queue.enqueue({
      id: '1',
      priority: 5,
      timestamp: Date.now(),
      fn: async () => 'low',
      resolve: () => {},
      reject: () => {},
    })

    queue.enqueue({
      id: '2',
      priority: 3,
      timestamp: Date.now(),
      fn: async () => 'medium',
      resolve: () => {},
      reject: () => {},
    })

    // Update priority of '1' to be highest
    queue.updatePriority('1', 1)

    const first = queue.dequeue()
    expect(first?.id).toBe('1')
  })

  it('should provide queue statistics', () => {
    const queue = new PriorityQueue()
    const now = Date.now()

    queue.enqueue({
      id: '1',
      priority: 1,
      timestamp: now - 1000,
      fn: async () => 'test',
      resolve: () => {},
      reject: () => {},
    })

    queue.enqueue({
      id: '2',
      priority: 10,
      timestamp: now,
      fn: async () => 'test',
      resolve: () => {},
      reject: () => {},
    })

    const stats = queue.getStats()
    expect(stats.size).toBe(2)
    expect(stats.isEmpty).toBe(false)
    expect(stats.highestPriority).toBe(1)
    expect(stats.lowestPriority).toBe(10)
    expect(stats.averagePriority).toBe(5.5)
  })
})

describe('MetricsCollector', () => {
  it('should track success metrics', () => {
    const collector = new MetricsCollector(true)

    collector.recordSuccess('test', 100, 5)
    collector.recordSuccess('test', 150, 3)

    const metrics = collector.getMetrics('test')
    expect(metrics.totalRequests).toBe(2)
    expect(metrics.successfulRequests).toBe(2)
    expect(metrics.averageWaitTime).toBe(125)
  })

  it('should track failure metrics', () => {
    const collector = new MetricsCollector(true)

    collector.recordFailure('test', new Error('failed'))
    collector.recordFailure('test', { status: 429, message: 'rate limit' })

    const metrics = collector.getMetrics('test')
    expect(metrics.totalRequests).toBe(2)
    expect(metrics.failedRequests).toBe(2)
    expect(metrics.rateLimitedRequests).toBe(1)
  })

  it('should calculate percentiles correctly', () => {
    const collector = new MetricsCollector(true)

    // Add latencies: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    for (let i = 1; i <= 10; i++) {
      collector.recordSuccess('test', i * 10)
    }

    const metrics = collector.getMetrics('test')
    expect(metrics.p50Latency).toBe(50)
    expect(metrics.p95Latency).toBe(100)
    expect(metrics.p99Latency).toBe(100)
  })

  it('should track queue sizes', () => {
    const collector = new MetricsCollector(true)

    collector.recordQueueSize('test', 5)
    collector.recordQueueSize('test', 10)

    const metrics = collector.getMetrics('test')
    expect(metrics.currentQueueSize).toBe(10)
  })

  it('should not collect metrics when disabled', () => {
    const collector = new MetricsCollector(false)

    collector.recordSuccess('test', 100)
    collector.recordFailure('test', new Error('failed'))

    const metrics = collector.getMetrics('test')
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.successfulRequests).toBe(0)
  })

  it('should reset metrics', () => {
    const collector = new MetricsCollector(true)

    collector.recordSuccess('test', 100)
    collector.recordFailure('test', new Error('failed'))

    collector.reset()

    const metrics = collector.getMetrics('test')
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.successfulRequests).toBe(0)
    expect(metrics.failedRequests).toBe(0)
  })
})

describe('UniversalThrottler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should execute functions with rate limiting', async () => {
    const throttler = new UniversalThrottler({
      limits: {
        requestsPerMinute: 60,
      },
    })

    await throttler.init()

    const fn = vi.fn(async () => 'success')
    const result = await throttler.execute('test', fn)

    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should queue requests when rate limited', async () => {
    const throttler = new UniversalThrottler({
      limits: {
        requestsPerMinute: 2, // Very low limit
      },
    })

    await throttler.init()

    const results: Promise<number>[] = []

    // Fire off 3 requests quickly
    for (let i = 0; i < 3; i++) {
      results.push(throttler.execute('test', async () => i, { queue: true, priority: i }))
    }

    // Process queue
    await vi.runAllTimersAsync()

    const values = await Promise.all(results)
    expect(values).toEqual([0, 1, 2])
  })

  it('should throw rate limit error when not queuing', async () => {
    const throttler = new UniversalThrottler({
      limits: {
        requestsPerMinute: 1,
      },
      retryConfig: {
        maxRetries: 0, // Don't retry
        initialDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
      },
    })

    await throttler.init()

    // First request succeeds
    await throttler.execute('test', async () => 'first')

    // Second request should fail
    await expect(throttler.execute('test', async () => 'second', { queue: false })).rejects.toThrow(
      RateLimitError
    )
  }, 5000)

  it('should support request coalescing', async () => {
    const throttler = new UniversalThrottler()
    await throttler.init()

    const fn = vi.fn(async () => {
      return 'result'
    })

    // Make multiple requests for the same key
    const promises = [
      throttler.coalesce('key', fn, 100),
      throttler.coalesce('key', fn, 100),
      throttler.coalesce('key', fn, 100),
    ]

    const results = await Promise.all(promises)

    // Function should only be called once
    expect(fn).toHaveBeenCalledTimes(1)
    expect(results).toEqual(['result', 'result', 'result'])
  }, 5000)

  it('should collect metrics when enabled', async () => {
    const throttler = new UniversalThrottler({
      metricsEnabled: true,
      limits: {
        requestsPerMinute: 60,
      },
    })

    await throttler.init()

    await throttler.execute('test', async () => 'success')
    await expect(
      throttler.execute('test', async () => {
        throw new Error('failed')
      })
    ).rejects.toThrow()

    const metrics = throttler.getMetrics('test')
    expect(metrics.totalRequests).toBe(2)
    expect(metrics.successfulRequests).toBe(1)
    expect(metrics.failedRequests).toBe(1)
  })

  it('should handle circuit breaker protection', async () => {
    const throttler = new UniversalThrottler({
      circuitBreakerConfig: {
        failureThreshold: 2,
        resetTimeout: 1000,
        halfOpenRequests: 1,
      },
    })

    await throttler.init()

    const fn = vi.fn(async () => {
      throw new Error('service error')
    })

    // Trigger circuit breaker
    await expect(throttler.execute('test', fn)).rejects.toThrow('service error')
    await expect(throttler.execute('test', fn)).rejects.toThrow('service error')

    // Circuit should be open now
    await expect(throttler.execute('test', fn)).rejects.toThrow(CircuitBreakerError)
    expect(fn).toHaveBeenCalledTimes(2) // No third call
  })

  it('should reset properly', async () => {
    const throttler = new UniversalThrottler({
      metricsEnabled: true,
    })

    await throttler.init()

    await throttler.execute('test', async () => 'success')

    await throttler.reset()

    const metrics = throttler.getMetrics('test')
    expect(metrics.totalRequests).toBe(0)
  })

  it('should handle timeout correctly', async () => {
    const throttler = new UniversalThrottler()
    await throttler.init()

    let resolveFn: any
    const fn = vi.fn(async () => {
      return new Promise((resolve) => {
        resolveFn = resolve
        // Never resolve to simulate timeout
      })
    })

    const promise = throttler.execute('test', fn, { timeout: 100 })

    // Wait for timeout
    await vi.advanceTimersByTimeAsync(150)

    await expect(promise).rejects.toThrow('Operation timed out')

    // Clean up
    if (resolveFn) resolveFn('cleanup')
  }, 5000)
})

describe('Integration Tests', () => {
  it('should handle high concurrency', async () => {
    const throttler = new UniversalThrottler({
      limits: {
        requestsPerMinute: 100,
        concurrentRequests: 5,
      },
    })

    await throttler.init()

    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(
        throttler.execute(
          'test',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return i
          },
          { queue: true }
        )
      )
    }

    const results = await Promise.all(promises)
    expect(results).toHaveLength(20)
  })

  it('should handle mixed success and failures gracefully', async () => {
    const throttler = new UniversalThrottler({
      metricsEnabled: true,
      retryConfig: {
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 2,
      },
    })

    await throttler.init()

    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(
        throttler
          .execute('test', async () => {
            if (i % 3 === 0) {
              throw new Error('random failure')
            }
            return i
          })
          .catch((err) => ({ error: err.message }))
      )
    }

    const results = await Promise.all(promises)
    const successes = results.filter((r) => typeof r === 'number').length
    const failures = results.filter((r) => r && typeof r === 'object' && 'error' in r).length

    expect(successes).toBeGreaterThan(0)
    expect(failures).toBeGreaterThan(0)
    expect(successes + failures).toBe(10)
  })
})

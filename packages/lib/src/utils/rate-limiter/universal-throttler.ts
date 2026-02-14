// packages/lib/src/utils/rate-limiter/universal-throttler.ts

import { v4 as uuidv4 } from 'uuid'
import { createScopedLogger } from '../../logger'
import { ExponentialBackoff } from './backoff-handler'
import { CircuitBreaker } from './circuit-breaker'
import { ConcurrencySemaphore } from './concurrency-semaphore'
import { MetricsCollector } from './metrics-collector'
import { PriorityQueue } from './priority-queue'
import { RedisRateLimiter } from './redis-rate-limiter'
import type { ExecutionOptions, QueuedRequest, RateLimiterConfig, ThrottlerConfig } from './types'
import { RateLimitError } from './types'

/** Default timeout for throttled operations in milliseconds */
const DEFAULT_OPERATION_TIMEOUT_MS = 30000

/** Maximum retries for queued requests */
const MAX_QUEUE_RETRIES = 3

/** Default max concurrent if not specified but concurrency limiting is needed */
const DEFAULT_MAX_CONCURRENT = 10

/**
 * Universal throttler for rate limiting API calls across all providers
 */
export class UniversalThrottler {
  private limiters: Map<string, RedisRateLimiter> = new Map()
  private queues: Map<string, PriorityQueue> = new Map()
  private circuitBreakers: Map<string, CircuitBreaker> = new Map()
  private concurrencySemaphore: ConcurrencySemaphore
  private metrics: MetricsCollector
  private processingQueues: Set<string> = new Set()
  private coalescedRequests: Map<string, Promise<any>> = new Map()
  private initialized = false
  private logger = createScopedLogger('UniversalThrottler')

  /**
   * Create a new universal throttler
   * @param config - Throttler configuration
   */
  constructor(private config: ThrottlerConfig = {}) {
    this.metrics = new MetricsCollector(config.metricsEnabled ?? false)
    this.concurrencySemaphore = new ConcurrencySemaphore(true)
  }

  /**
   * Initialize the throttler
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Initialize concurrency semaphore
    await this.concurrencySemaphore.init()

    // Initialize all existing limiters
    const initPromises: Promise<void>[] = []
    for (const limiter of Array.from(this.limiters.values())) {
      if (limiter.init) {
        initPromises.push(limiter.init())
      }
    }

    await Promise.all(initPromises)
    this.initialized = true

    this.logger.info('Universal throttler initialized', {
      provider: this.config.provider,
      metricsEnabled: this.config.metricsEnabled,
    })
  }

  /**
   * Get or create a rate limiter for a specific context
   * @param context - Context identifier
   * @returns Rate limiter instance
   */
  private async getLimiter(context: string): Promise<RedisRateLimiter> {
    if (!this.limiters.has(context)) {
      const config = this.getConfigForContext(context)
      const limiter = new RedisRateLimiter(config)

      if (!this.initialized) {
        await this.init()
      } else {
        await limiter.init()
      }

      // Check if Redis is actually available after initialization
      const isRedisAvailable = limiter.isRedisAvailable()
      if (!isRedisAvailable) {
        this.logger.warn('Redis is not available for rate limiting, using in-memory fallback', {
          context,
          provider: this.config.provider,
        })
      }

      this.limiters.set(context, limiter)
    }

    return this.limiters.get(context)!
  }

  /**
   * Get configuration for a specific context
   * @param context - Context identifier
   * @returns Rate limiter configuration
   */
  private getConfigForContext(context: string): RateLimiterConfig {
    // Check if we have context-specific limits
    if (this.config.limits?.contexts?.[context]) {
      const contextLimits = this.config.limits.contexts[context]
      return {
        ...contextLimits,
        retryConfig: this.config.retryConfig,
        name: context,
      }
    }

    // Use default limits
    return {
      maxRequests: this.config.limits?.requestsPerMinute ?? 100,
      perInterval: 60000,
      maxConcurrent: this.config.limits?.concurrentRequests,
      retryConfig: this.config.retryConfig,
      name: context,
    }
  }

  /**
   * Get or create a circuit breaker for a context
   * @param context - Context identifier
   * @returns Circuit breaker instance
   */
  private getCircuitBreaker(context: string): CircuitBreaker {
    if (!this.circuitBreakers.has(context)) {
      const config = this.config.circuitBreakerConfig ?? {
        failureThreshold: 5,
        resetTimeout: 60000,
        halfOpenRequests: 2,
        monitoringWindow: 300000, // 5 minutes
      }
      this.circuitBreakers.set(context, new CircuitBreaker(config))
    }

    return this.circuitBreakers.get(context)!
  }

  /**
   * Get or create a priority queue for a context
   * @param context - Context identifier
   * @returns Priority queue instance
   */
  private getQueue(context: string): PriorityQueue {
    if (!this.queues.has(context)) {
      this.queues.set(context, new PriorityQueue())
    }
    return this.queues.get(context)!
  }

  /**
   * Execute a function with rate limiting, concurrency limiting, and circuit breaker protection
   * @param context - Context identifier for rate limiting
   * @param fn - Function to execute
   * @param options - Execution options
   * @returns Result of the function
   */
  async execute<T>(context: string, fn: () => Promise<T>, options?: ExecutionOptions): Promise<T> {
    const startTime = Date.now()

    this.logger.debug('Execute called', {
      context,
      userId: options?.userId,
      queue: options?.queue,
      cost: options?.cost,
    })

    // Initialize if needed
    if (!this.initialized) {
      await this.init()
    }

    const limiter = await this.getLimiter(context)
    const breaker = this.getCircuitBreaker(context)
    const backoff = new ExponentialBackoff(
      this.config.retryConfig ?? {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitter: true,
      }
    )

    // Get concurrency limit for this context
    const contextConfig = this.getConfigForContext(context)
    const maxConcurrent = contextConfig.maxConcurrent

    // Record circuit breaker state for metrics
    this.metrics.recordCircuitBreakerState(context, breaker.getState())

    return breaker.execute(async () => {
      return backoff.executeWithRetry(
        async () => {
          // Build the rate limit key (used for both rate limiting and concurrency)
          const key = this.buildRateLimitKey(context, options)
          const cost = options?.cost ?? 1

          this.logger.debug('Attempting to acquire tokens', { context, key, cost })

          // Try to acquire tokens from rate limiter
          const acquired = await limiter.acquire(key, cost)

          this.logger.debug('Token acquisition result', { context, acquired, key })

          if (!acquired) {
            // If queuing is enabled, add to queue
            if (options?.queue) {
              this.logger.debug('Queuing request', { context, key })
              return this.queueRequest(context, fn, options)
            }

            // Record rate limit hit
            this.metrics.recordFailure(
              context,
              new RateLimitError(`Rate limit exceeded for ${context}`)
            )

            // Get available tokens for better error message
            const available = await limiter.getAvailableTokens(key)
            throw new RateLimitError(
              `Rate limit exceeded for ${context}. Available tokens: ${available}, required: ${cost}`,
              this.calculateRetryAfter(context)
            )
          }

          // Check concurrent request limit if configured
          let concurrencyAcquired = false
          const concurrencyKey = `${context}:${key}`

          if (maxConcurrent && maxConcurrent > 0) {
            this.logger.debug('Checking concurrency limit', {
              context,
              key: concurrencyKey,
              maxConcurrent,
            })

            concurrencyAcquired = await this.concurrencySemaphore.tryAcquire(
              concurrencyKey,
              maxConcurrent
            )

            if (!concurrencyAcquired) {
              // If queuing is enabled, wait for a slot
              if (options?.queue) {
                this.logger.debug('Waiting for concurrency slot', { context, key: concurrencyKey })
                const timeout = options?.timeout ?? DEFAULT_OPERATION_TIMEOUT_MS
                try {
                  await this.concurrencySemaphore.acquire(concurrencyKey, maxConcurrent, timeout)
                  concurrencyAcquired = true
                } catch (error) {
                  this.logger.warn('Concurrency wait timed out', {
                    context,
                    key: concurrencyKey,
                    maxConcurrent,
                  })
                  throw new RateLimitError(
                    `Concurrency limit exceeded for ${context}. Max concurrent: ${maxConcurrent}`,
                    1000 // Retry after 1 second
                  )
                }
              } else {
                const currentCount = await this.concurrencySemaphore.getCount(concurrencyKey)
                throw new RateLimitError(
                  `Concurrency limit exceeded for ${context}. Current: ${currentCount}, Max: ${maxConcurrent}`,
                  1000 // Retry after 1 second
                )
              }
            }

            this.logger.debug('Concurrency slot acquired', {
              context,
              key: concurrencyKey,
              maxConcurrent,
            })
          }

          // Record available tokens
          const availableTokens = await limiter.getAvailableTokens(key)
          this.metrics.recordAvailableTokens(context, availableTokens)

          // Execute the function with default timeout if none specified
          const timeout = options?.timeout ?? DEFAULT_OPERATION_TIMEOUT_MS

          this.logger.debug('Executing function', { context, timeout })

          try {
            const result = await this.executeWithTimeout(fn, timeout)

            const duration = Date.now() - startTime
            this.logger.debug('Execute completed successfully', { context, duration })

            // Record success
            this.metrics.recordSuccess(context, duration, cost)

            return result
          } catch (error) {
            const duration = Date.now() - startTime
            this.logger.debug('Execute failed', {
              context,
              duration,
              error: error instanceof Error ? error.message : error,
            })

            // Record failure
            this.metrics.recordFailure(context, error)
            throw error
          } finally {
            // Always release concurrency slot if acquired
            if (concurrencyAcquired && maxConcurrent && maxConcurrent > 0) {
              await this.concurrencySemaphore.release(concurrencyKey)
              this.logger.debug('Concurrency slot released', { context, key: concurrencyKey })
            }
          }
        },
        (error) => this.isRetryableError(error)
      )
    })
  }

  /**
   * Execute a function with timeout
   * @param fn - Function to execute
   * @param timeout - Timeout in milliseconds
   * @returns Result of the function
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Operation timed out after ${timeout}ms`)),
        timeout
      )
    })

    try {
      const result = await Promise.race([fn(), timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  /**
   * Queue a request for later execution
   * @param context - Context identifier
   * @param fn - Function to execute
   * @param options - Execution options
   * @returns Promise that resolves when the request is executed
   */
  private async queueRequest<T>(
    context: string,
    fn: () => Promise<T>,
    options?: ExecutionOptions
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const queue = this.getQueue(context)
      const request: QueuedRequest<T> = {
        id: uuidv4(),
        priority: options?.priority ?? 5,
        timestamp: Date.now(),
        fn,
        resolve,
        reject,
        context: options,
      }

      queue.enqueue(request)
      const queueSize = queue.size()
      this.metrics.recordQueueSize(context, queueSize)

      this.logger.debug('Request queued', { context, queueSize, requestId: request.id })

      // Start processing the queue if not already processing
      if (!this.processingQueues.has(context)) {
        this.processQueue(context)
      }
    })
  }

  /**
   * Process queued requests for a context
   * @param context - Context identifier
   */
  private async processQueue(context: string): Promise<void> {
    if (this.processingQueues.has(context)) {
      return
    }

    this.processingQueues.add(context)
    const queue = this.getQueue(context)

    this.logger.debug('Starting queue processing', { context, queueSize: queue.size() })

    try {
      while (!queue.isEmpty()) {
        const request = queue.dequeue()
        if (!request) break

        this.logger.debug('Processing queued request', {
          context,
          requestId: request.id,
          retries: request.retries ?? 0,
        })

        try {
          // Try to execute the request (without queuing to avoid infinite loop)
          const optionsWithoutQueue = { ...request.context, queue: false }
          const result = await this.execute(context, request.fn, optionsWithoutQueue)
          request.resolve(result)

          this.logger.debug('Queued request completed', { context, requestId: request.id })
        } catch (error) {
          // If it's a rate limit error and we haven't exceeded retries, re-queue
          if (error instanceof RateLimitError && (request.retries ?? 0) < MAX_QUEUE_RETRIES) {
            request.retries = (request.retries ?? 0) + 1
            queue.enqueue(request)

            this.logger.debug('Re-queuing request after rate limit', {
              context,
              requestId: request.id,
              retries: request.retries,
            })
          } else {
            this.logger.debug('Queued request failed', {
              context,
              requestId: request.id,
              error: error instanceof Error ? error.message : error,
            })
            request.reject(error)
          }
        }

        // Update queue size metric
        this.metrics.recordQueueSize(context, queue.size())

        // Small delay between processing queued items
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } finally {
      this.processingQueues.delete(context)
      this.logger.debug('Queue processing completed', { context })
    }
  }

  /**
   * Coalesce similar requests within a time window
   * @param key - Coalescing key
   * @param fn - Function to execute
   * @param windowMs - Time window in milliseconds
   * @returns Result of the function
   */
  async coalesce<T>(key: string, fn: () => Promise<T>, windowMs: number = 100): Promise<T> {
    // Check if we already have a pending request for this key
    if (this.coalescedRequests.has(key)) {
      return this.coalescedRequests.get(key) as Promise<T>
    }

    // Create a new promise that will be shared by all requests in the window
    const promise = (async () => {
      try {
        return await fn()
      } finally {
        // Clean up after the window expires
        setTimeout(() => {
          this.coalescedRequests.delete(key)
        }, windowMs)
      }
    })()

    this.coalescedRequests.set(key, promise)
    return promise
  }

  /**
   * Adapt rate limits based on response headers
   * @param context - Context identifier
   * @param headers - Response headers
   */
  async adaptLimits(context: string, headers: Headers | Record<string, string>): Promise<void> {
    const getHeader = (name: string): string | null => {
      if (headers instanceof Headers) {
        return headers.get(name)
      }
      return headers[name] || null
    }

    const remaining = getHeader('x-ratelimit-remaining')
    const limit = getHeader('x-ratelimit-limit')
    const reset = getHeader('x-ratelimit-reset')

    if (remaining !== null && limit !== null) {
      const remainingNum = parseInt(remaining, 10)
      const limitNum = parseInt(limit, 10)

      // Log when we're approaching limits
      if (remainingNum < limitNum * 0.2) {
        this.logger.warn('Approaching rate limit', {
          context,
          remaining: remainingNum,
          limit: limitNum,
          reset,
        })
      }
    }

    // Check for Retry-After header
    const retryAfter = getHeader('retry-after')
    if (retryAfter) {
      const retryAfterMs = this.parseRetryAfter(retryAfter)
      if (retryAfterMs > 0) {
        this.logger.info('Received Retry-After header', {
          context,
          retryAfterMs,
        })
      }
    }
  }

  /**
   * Build a rate limit key from context and options
   * @param context - Context identifier
   * @param options - Execution options
   * @returns Rate limit key
   */
  private buildRateLimitKey(context: string, options?: ExecutionOptions): string {
    const parts = [context]

    if (options?.userId) {
      parts.push(`user:${options.userId}`)
    } else if (options?.orgId) {
      parts.push(`org:${options.orgId}`)
    } else {
      parts.push('global')
    }

    return parts.join(':')
  }

  /**
   * Check if an error is retryable
   * @param error - The error to check
   * @returns true if the error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof RateLimitError) {
      return true
    }

    const statusCode = error?.response?.status || error?.status || error?.statusCode
    const retryableCodes = [429, 503, 502, 504, 408]

    return retryableCodes.includes(statusCode)
  }

  /**
   * Calculate retry-after time for a context
   * @param context - Context identifier
   * @returns Retry-after time in milliseconds
   */
  private calculateRetryAfter(context: string): number {
    const config = this.getConfigForContext(context)
    // Simple calculation - could be more sophisticated
    return config.perInterval / config.maxRequests
  }

  /**
   * Parse Retry-After header value
   * @param retryAfter - Retry-After header value
   * @returns Retry time in milliseconds
   */
  private parseRetryAfter(retryAfter: string): number {
    // Check if it's a number (seconds)
    const seconds = parseInt(retryAfter, 10)
    if (!Number.isNaN(seconds)) {
      return seconds * 1000
    }

    // Check if it's a date
    const date = new Date(retryAfter)
    if (!Number.isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now())
    }

    return 0
  }

  /**
   * Get metrics for the throttler
   * @param context - Optional context to filter by
   * @returns Metrics object
   */
  getMetrics(context?: string) {
    return this.metrics.getMetrics(context)
  }

  /**
   * Report metrics to monitoring service
   */
  async reportMetrics(): Promise<void> {
    await this.metrics.report()
  }

  /**
   * Reset the throttler
   * @param context - Optional context to reset
   */
  async reset(context?: string): Promise<void> {
    if (context) {
      // Reset specific context
      const limiter = this.limiters.get(context)
      if (limiter) {
        await limiter.reset(context)
      }

      const breaker = this.circuitBreakers.get(context)
      if (breaker) {
        breaker.reset()
      }

      const queue = this.queues.get(context)
      if (queue) {
        queue.clear('Throttler reset')
      }
    } else {
      // Reset all contexts
      for (const [ctx, limiter] of Array.from(this.limiters.entries())) {
        await limiter.reset(ctx)
      }

      for (const breaker of Array.from(this.circuitBreakers.values())) {
        breaker.reset()
      }

      for (const queue of Array.from(this.queues.values())) {
        queue.clear('Throttler reset')
      }

      this.metrics.reset()
    }
  }

  /**
   * Get statistics about the throttler
   */
  getStats() {
    const stats: any = {
      limiters: this.limiters.size,
      queues: this.queues.size,
      circuitBreakers: this.circuitBreakers.size,
      processingQueues: this.processingQueues.size,
      coalescedRequests: this.coalescedRequests.size,
      queueStats: {},
      circuitBreakerStats: {},
      concurrencyStats: this.concurrencySemaphore.getStats(),
    }

    // Add queue statistics
    for (const [context, queue] of Array.from(this.queues.entries())) {
      stats.queueStats[context] = queue.getStats()
    }

    // Add circuit breaker statistics
    for (const [context, breaker] of Array.from(this.circuitBreakers.entries())) {
      stats.circuitBreakerStats[context] = breaker.getStats()
    }

    return stats
  }

  /**
   * Shutdown the throttler gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down universal throttler')

    // Clear all queues
    for (const queue of Array.from(this.queues.values())) {
      queue.clear('Throttler shutdown')
    }

    // Reset all circuit breakers
    for (const breaker of Array.from(this.circuitBreakers.values())) {
      breaker.reset()
    }

    // Shutdown concurrency semaphore
    await this.concurrencySemaphore.shutdown()

    // Report final metrics
    if (this.metrics.isEnabled()) {
      await this.metrics.report()
    }

    // Clear all maps
    this.limiters.clear()
    this.queues.clear()
    this.circuitBreakers.clear()
    this.processingQueues.clear()
    this.coalescedRequests.clear()

    this.initialized = false
  }
}

// packages/lib/src/utils/rate-limiter/types.ts

/**
 * Configuration for rate limiting
 */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed */
  maxRequests: number
  /** Time interval in milliseconds */
  perInterval: number
  /** Maximum concurrent requests (optional) */
  maxConcurrent?: number
  /** Minimum time between requests in milliseconds (optional) */
  minInterval?: number
  /** Retry configuration (optional) */
  retryConfig?: RetryConfig
  /** Name for logging/metrics (optional) */
  name?: string
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number
  /** Initial delay in milliseconds */
  initialDelay: number
  /** Maximum delay in milliseconds */
  maxDelay: number
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier: number
  /** Error codes/messages that are retryable (optional) */
  retryableErrors?: string[]
  /** Add random jitter to delays (optional) */
  jitter?: boolean
}

/**
 * Enhanced rate limits extending provider capabilities
 */
export interface EnhancedRateLimits {
  /** Messages per minute (from existing capabilities) */
  messagesPerMinute?: number
  /** Messages per hour (from existing capabilities) */
  messagesPerHour?: number
  /** Messages per day (from existing capabilities) */
  messagesPerDay?: number

  /** API calls per second */
  requestsPerSecond?: number
  /** API calls per minute */
  requestsPerMinute?: number
  /** API calls per hour */
  requestsPerHour?: number
  /** Maximum burst requests */
  burstLimit?: number
  /** Maximum concurrent API calls */
  concurrentRequests?: number
  /** Maximum items per batch */
  batchSize?: number

  /** Context-specific limits */
  contexts?: {
    [key: string]: {
      maxRequests: number
      perInterval: number
      maxConcurrent?: number
    }
  }
}

/**
 * Options for executing a function with rate limiting
 */
export interface ExecutionOptions {
  /** User ID for user-scoped rate limiting */
  userId?: string
  /** Organization ID for org-scoped rate limiting */
  orgId?: string
  /** Cost in quota units */
  cost?: number
  /** Whether to queue if rate limited */
  queue?: boolean
  /** Priority for queued requests */
  priority?: number
  /** Timeout in milliseconds */
  timeout?: number
  /** Whether the operation is retryable */
  retryable?: boolean
  /** Context-specific metadata */
  metadata?: Record<string, any>
}

/**
 * Queued request structure
 */
export interface QueuedRequest<T = any> {
  /** Unique request ID */
  id: string
  /** Priority (lower number = higher priority) */
  priority: number
  /** Timestamp when queued */
  timestamp: number
  /** Function to execute */
  fn: () => Promise<T>
  /** Promise resolver */
  resolve: (value: T) => void
  /** Promise rejector */
  reject: (error: any) => void
  /** Number of retries attempted */
  retries?: number
  /** Additional context */
  context?: any
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number
  /** Time to wait before attempting half-open state (ms) */
  resetTimeout: number
  /** Number of successful requests in half-open state to close circuit */
  halfOpenRequests: number
  /** Monitoring window for failure rate (ms) */
  monitoringWindow?: number
}

/**
 * Throttler configuration
 */
export interface ThrottlerConfig {
  /** Provider type */
  provider?: string
  /** Rate limits configuration */
  limits?: EnhancedRateLimits
  /** Retry configuration */
  retryConfig?: RetryConfig
  /** Enable metrics collection */
  metricsEnabled?: boolean
  /** Circuit breaker configuration */
  circuitBreakerConfig?: CircuitBreakerConfig
  /** Enable request coalescing */
  coalescingEnabled?: boolean
  /** Coalescing window in milliseconds */
  coalescingWindow?: number
}

/**
 * Metrics for monitoring rate limiting
 */
export interface ThrottlerMetrics {
  /** Total number of requests */
  totalRequests: number
  /** Number of successful requests */
  successfulRequests: number
  /** Number of rate limited requests */
  rateLimitedRequests: number
  /** Number of retried requests */
  retriedRequests: number
  /** Number of failed requests */
  failedRequests: number

  /** Average wait time in ms */
  averageWaitTime: number
  /** 50th percentile latency */
  p50Latency: number
  /** 95th percentile latency */
  p95Latency: number
  /** 99th percentile latency */
  p99Latency: number

  /** Current queue size */
  currentQueueSize: number
  /** Available tokens */
  tokensAvailable: number
  /** Quota usage percentage */
  quotaUsagePercent: number
  /** Rate limit headroom */
  rateLimitHeadroom: number

  /** Circuit breaker states by context */
  circuitBreakerState: Map<string, 'open' | 'closed' | 'half-open'>

  /** Provider-specific metrics */
  providerMetrics: Map<
    string,
    {
      requestsPerMinute: number
      errorRate: number
      avgResponseTime: number
      quotaUnitsConsumed: number
    }
  >
}

/**
 * Base interface for rate limiters
 */
export interface RateLimiter {
  /** Initialize the rate limiter */
  init?(): Promise<void>
  /** Acquire tokens from the rate limiter */
  acquire(key: string, tokens?: number): Promise<boolean>
  /** Get available tokens */
  getAvailableTokens?(key: string): Promise<number>
  /** Reset the rate limiter */
  reset?(key: string): Promise<void>
}

/**
 * Custom error for rate limiting
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly context?: any
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

/**
 * Custom error for circuit breaker
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: 'open' | 'half-open',
    public readonly retryAfter?: Date
  ) {
    super(message)
    this.name = 'CircuitBreakerError'
  }
}

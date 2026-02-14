// packages/lib/src/utils/rate-limiter/index.ts

/**
 * Universal Rate Limiting Solution
 *
 * A comprehensive rate limiting and throttling system for API providers.
 * Supports Redis-based distributed rate limiting with fallback to in-memory.
 *
 * Key features:
 * - Multi-provider support (Gmail, Outlook, Facebook, etc.)
 * - Redis-aware with Upstash/IORedis/AWS ElastiCache support
 * - Circuit breaker pattern for fault tolerance
 * - Exponential backoff with jitter
 * - Priority queue system
 * - Request coalescing
 * - Comprehensive metrics collection
 * - Adaptive rate limiting based on API responses
 */

export { ExponentialBackoff } from './backoff-handler'
export { CircuitBreaker } from './circuit-breaker'
export { ConcurrencySemaphore } from './concurrency-semaphore'
// Configuration
export {
  createThrottlerForProvider,
  getConfigManager,
  RateLimiterConfigManager,
} from './config-manager'
export { MetricsCollector } from './metrics-collector'
export { PriorityQueue } from './priority-queue'
export {
  DEFAULT_RETRY_CONFIG,
  ENHANCED_PROVIDER_LIMITS,
  GMAIL_QUOTA_COSTS,
  getContextLimits,
  getDefaultRateLimits,
  getGmailQuotaCost,
  getMergedProviderLimits,
  supportsRateLimiting,
} from './provider-configs'
export { RedisRateLimiter } from './redis-rate-limiter'
// Core components
export { TokenBucket } from './token-bucket'
// Core types and interfaces
export type {
  CircuitBreakerConfig,
  EnhancedRateLimits,
  ExecutionOptions,
  QueuedRequest,
  RateLimiter,
  RateLimiterConfig,
  RetryConfig,
  ThrottlerConfig,
  ThrottlerMetrics,
} from './types'
// Custom errors
export { CircuitBreakerError, RateLimitError } from './types'
export { UniversalThrottler } from './universal-throttler'

// Convenience factory function
import type { IntegrationProviderType } from '@auxx/database/types'
import { getConfigManager, RateLimiterConfigManager } from './config-manager'
import { UniversalThrottler } from './universal-throttler'

/**
 * Create a pre-configured throttler for a specific provider
 * @param provider - Provider type
 * @returns Configured throttler instance
 *
 * @example
 * ```typescript
 * const throttler = await createThrottler(IntegrationProviderType.google)
 *
 * // Execute with rate limiting
 * const result = await throttler.execute('gmail.sync', async () => {
 *   return await fetchMessages()
 * }, {
 *   userId: 'user123',
 *   cost: 5, // Gmail quota units
 *   queue: true, // Queue if rate limited
 *   priority: 1, // High priority
 * })
 * ```
 */
export async function createThrottler(
  provider: IntegrationProviderType
): Promise<UniversalThrottler> {
  const configManager = getConfigManager()
  const config = configManager.getThrottlerConfig(provider)

  const throttler = new UniversalThrottler(config)
  await throttler.init()

  return throttler
}

/**
 * Create a simple rate limiter without provider configuration
 * @param maxRequests - Maximum requests allowed
 * @param perInterval - Time interval in milliseconds
 * @returns Configured throttler instance
 *
 * @example
 * ```typescript
 * const limiter = await createSimpleRateLimiter(100, 60000) // 100 requests per minute
 *
 * await limiter.execute('my-operation', async () => {
 *   return await performOperation()
 * })
 * ```
 */
export async function createSimpleRateLimiter(
  maxRequests: number,
  perInterval: number
): Promise<UniversalThrottler> {
  const throttler = new UniversalThrottler({
    limits: {
      requestsPerMinute: maxRequests * (60000 / perInterval),
    },
  })

  await throttler.init()
  return throttler
}

/**
 * Utility to check if rate limiting is enabled globally
 * @returns true if rate limiting is enabled
 */
export function isRateLimitingEnabled(): boolean {
  const configManager = getConfigManager()
  return configManager.isRateLimitingEnabled()
}

/**
 * Default export for easy importing
 */
export default {
  createThrottler,
  createSimpleRateLimiter,
  isRateLimitingEnabled,
  UniversalThrottler,
  RateLimiterConfigManager: RateLimiterConfigManager,
}

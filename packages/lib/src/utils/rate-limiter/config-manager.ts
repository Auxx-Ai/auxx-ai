// packages/lib/src/utils/rate-limiter/config-manager.ts

import { configService } from '@auxx/credentials'
import { IntegrationProviderType as IntegrationProviderTypeEnum } from '@auxx/database/enums'
import type { IntegrationProviderType } from '@auxx/database/types'
import { createScopedLogger } from '../../logger'
import {
  DEFAULT_RETRY_CONFIG,
  getDefaultRateLimits,
  getMergedProviderLimits,
} from './provider-configs'
import type { EnhancedRateLimits, RateLimiterConfig, ThrottlerConfig } from './types'

/**
 * Configuration manager for rate limiting
 * Handles loading configuration from environment variables and defaults
 */
export class RateLimiterConfigManager {
  private config: Map<IntegrationProviderType, EnhancedRateLimits> = new Map()
  private globalEnabled: boolean = true
  private logger = createScopedLogger('RateLimiterConfigManager')

  constructor() {
    this.loadDefaults()
    this.loadEnvironmentOverrides()
  }

  /**
   * Load default configurations for all providers
   */
  private loadDefaults(): void {
    // Load enhanced limits for each provider
    for (const providerType of Object.values(IntegrationProviderTypeEnum)) {
      const mergedLimits = getMergedProviderLimits(providerType)
      this.config.set(providerType, mergedLimits)
    }

    this.logger.info('Loaded default rate limit configurations', {
      providers: Array.from(this.config.keys()),
    })
  }

  /**
   * Load environment variable overrides
   */
  private loadEnvironmentOverrides(): void {
    // Global enable/disable
    if (configService.get<string>('DISABLE_RATE_LIMITING') === 'true') {
      this.globalEnabled = false
      this.logger.warn('⚠️ Rate limiting is DISABLED via environment variable')
      return
    }

    // Gmail overrides
    this.loadGmailOverrides()

    // Outlook overrides
    this.loadOutlookOverrides()

    // Facebook overrides
    this.loadFacebookOverrides()

    // Shopify overrides
    this.loadShopifyOverrides()
  }

  /**
   * Load Gmail-specific environment overrides
   */
  private loadGmailOverrides(): void {
    const gmailConfig = this.config.get(IntegrationProviderTypeEnum.google) || {}

    const gmailRatePerSecond = configService.get<string>('GMAIL_RATE_LIMIT_PER_SECOND')
    if (gmailRatePerSecond) {
      gmailConfig.requestsPerSecond = parseInt(gmailRatePerSecond, 10)
      this.logger.info('Gmail rate limit per second overridden', {
        value: gmailConfig.requestsPerSecond,
      })
    }

    const gmailRatePerMinute = configService.get<string>('GMAIL_RATE_LIMIT_PER_MINUTE')
    if (gmailRatePerMinute) {
      gmailConfig.requestsPerMinute = parseInt(gmailRatePerMinute, 10)
      this.logger.info('Gmail rate limit per minute overridden', {
        value: gmailConfig.requestsPerMinute,
      })
    }

    const gmailBatchSize = configService.get<string>('GMAIL_BATCH_SIZE')
    if (gmailBatchSize) {
      gmailConfig.batchSize = parseInt(gmailBatchSize, 10)
      this.logger.info('Gmail batch size overridden', { value: gmailConfig.batchSize })
    }

    const gmailMaxConcurrent = configService.get<string>('GMAIL_MAX_CONCURRENT')
    if (gmailMaxConcurrent) {
      gmailConfig.concurrentRequests = parseInt(gmailMaxConcurrent, 10)
      this.logger.info('Gmail max concurrent requests overridden', {
        value: gmailConfig.concurrentRequests,
      })
    }

    this.config.set(IntegrationProviderTypeEnum.google, gmailConfig)
  }

  /**
   * Load Outlook-specific environment overrides
   */
  private loadOutlookOverrides(): void {
    const outlookConfig = this.config.get(IntegrationProviderTypeEnum.outlook) || {}

    const outlookRatePerMinute = configService.get<string>('OUTLOOK_RATE_LIMIT_PER_MINUTE')
    if (outlookRatePerMinute) {
      outlookConfig.requestsPerMinute = parseInt(outlookRatePerMinute, 10)
      this.logger.info('Outlook rate limit per minute overridden', {
        value: outlookConfig.requestsPerMinute,
      })
    }

    const outlookRatePerHour = configService.get<string>('OUTLOOK_RATE_LIMIT_PER_HOUR')
    if (outlookRatePerHour) {
      outlookConfig.requestsPerHour = parseInt(outlookRatePerHour, 10)
      this.logger.info('Outlook rate limit per hour overridden', {
        value: outlookConfig.requestsPerHour,
      })
    }

    const outlookBatchSize = configService.get<string>('OUTLOOK_BATCH_SIZE')
    if (outlookBatchSize) {
      outlookConfig.batchSize = parseInt(outlookBatchSize, 10)
      this.logger.info('Outlook batch size overridden', { value: outlookConfig.batchSize })
    }

    this.config.set(IntegrationProviderTypeEnum.outlook, outlookConfig)
  }

  /**
   * Load Facebook-specific environment overrides
   */
  private loadFacebookOverrides(): void {
    const facebookConfig = this.config.get(IntegrationProviderTypeEnum.facebook) || {}

    const fbRatePerHour = configService.get<string>('FACEBOOK_RATE_LIMIT_PER_HOUR')
    if (fbRatePerHour) {
      facebookConfig.requestsPerHour = parseInt(fbRatePerHour, 10)
      this.logger.info('Facebook rate limit per hour overridden', {
        value: facebookConfig.requestsPerHour,
      })
    }

    this.config.set(IntegrationProviderTypeEnum.facebook, facebookConfig)
  }

  /**
   * Load Shopify-specific environment overrides
   */
  private loadShopifyOverrides(): void {
    const shopifyConfig = this.config.get(IntegrationProviderTypeEnum.shopify) || {}

    const shopifyRatePerSecond = configService.get<string>('SHOPIFY_RATE_LIMIT_PER_SECOND')
    if (shopifyRatePerSecond) {
      shopifyConfig.requestsPerSecond = parseInt(shopifyRatePerSecond, 10)
      this.logger.info('Shopify rate limit per second overridden', {
        value: shopifyConfig.requestsPerSecond,
      })
    }

    this.config.set(IntegrationProviderTypeEnum.shopify, shopifyConfig)
  }

  /**
   * Get configuration for a specific provider and context
   * @param providerType - Provider type
   * @param context - Optional context (e.g., 'sync', 'send', 'batch')
   * @returns Rate limiter configuration
   */
  getConfig(providerType: IntegrationProviderType, context?: string): RateLimiterConfig {
    // Check if rate limiting is disabled
    if (!this.isRateLimitingEnabled()) {
      // Return very high limits when disabled
      return {
        maxRequests: 999999,
        perInterval: 1000,
        maxConcurrent: 999999,
        retryConfig: DEFAULT_RETRY_CONFIG,
        name: `${providerType}${context ? `:${context}` : ''}`,
      }
    }

    const providerConfig = this.config.get(providerType)

    // Check for context-specific limits
    if (context && providerConfig?.contexts?.[context]) {
      return {
        ...providerConfig.contexts[context],
        retryConfig: this.getRetryConfig(providerType),
        name: `${providerType}:${context}`,
      }
    }

    // Return provider defaults
    const defaultLimits = providerConfig || getDefaultRateLimits()
    return {
      maxRequests: defaultLimits.requestsPerMinute || 100,
      perInterval: 60000,
      maxConcurrent: defaultLimits.concurrentRequests || 10,
      minInterval: defaultLimits.requestsPerSecond
        ? 1000 / defaultLimits.requestsPerSecond
        : undefined,
      retryConfig: this.getRetryConfig(providerType),
      name: providerType,
    }
  }

  /**
   * Get throttler configuration for a provider
   * @param providerType - Provider type
   * @returns Throttler configuration
   */
  getThrottlerConfig(providerType: IntegrationProviderType): ThrottlerConfig {
    const providerLimits = this.config.get(providerType)

    return {
      provider: providerType,
      limits: providerLimits || getDefaultRateLimits(),
      retryConfig: this.getRetryConfig(providerType),
      metricsEnabled: this.isMetricsEnabled(),
      circuitBreakerConfig: this.getCircuitBreakerConfig(providerType),
      coalescingEnabled: this.isCoalescingEnabled(),
      coalescingWindow: this.getCoalescingWindow(),
    }
  }

  /**
   * Get retry configuration for a provider
   * @param providerType - Provider type
   * @returns Retry configuration
   */
  private getRetryConfig(providerType: IntegrationProviderType) {
    // Could have provider-specific retry configs in the future
    const config = { ...DEFAULT_RETRY_CONFIG }

    // Override from environment if available
    const maxRetries = configService.get<string>(`${providerType.toUpperCase()}_MAX_RETRIES`)
    if (maxRetries) {
      config.maxRetries = parseInt(maxRetries, 10)
    }

    const initialDelay = configService.get<string>(
      `${providerType.toUpperCase()}_BACKOFF_INITIAL_DELAY`
    )
    if (initialDelay) {
      config.initialDelay = parseInt(initialDelay, 10)
    }

    const maxDelay = configService.get<string>(`${providerType.toUpperCase()}_BACKOFF_MAX_DELAY`)
    if (maxDelay) {
      config.maxDelay = parseInt(maxDelay, 10)
    }

    return config
  }

  /**
   * Get circuit breaker configuration for a provider
   * @param providerType - Provider type
   * @returns Circuit breaker configuration
   */
  private getCircuitBreakerConfig(providerType: IntegrationProviderType) {
    return {
      failureThreshold: configService.get<number>('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
      resetTimeout: configService.get<number>('CIRCUIT_BREAKER_RESET_TIMEOUT', 60000),
      halfOpenRequests: configService.get<number>('CIRCUIT_BREAKER_HALF_OPEN_REQUESTS', 2),
      monitoringWindow: configService.get<number>('CIRCUIT_BREAKER_MONITORING_WINDOW', 300000),
    }
  }

  /**
   * Check if rate limiting is enabled
   * @returns true if rate limiting is enabled
   */
  isRateLimitingEnabled(): boolean {
    return this.globalEnabled && configService.get<string>('DISABLE_RATE_LIMITING') !== 'true'
  }

  /**
   * Check if metrics collection is enabled
   * @returns true if metrics are enabled
   */
  isMetricsEnabled(): boolean {
    return configService.get<string>('RATE_LIMITER_METRICS_ENABLED') === 'true'
  }

  /**
   * Check if request coalescing is enabled
   * @returns true if coalescing is enabled
   */
  isCoalescingEnabled(): boolean {
    return configService.get<string>('RATE_LIMITER_COALESCING_ENABLED') !== 'false' // Default to true
  }

  /**
   * Get coalescing window duration
   * @returns Coalescing window in milliseconds
   */
  getCoalescingWindow(): number {
    return configService.get<number>('RATE_LIMITER_COALESCING_WINDOW', 100)
  }

  /**
   * Get all configured providers
   * @returns Array of provider types
   */
  getConfiguredProviders(): IntegrationProviderType[] {
    return Array.from(this.config.keys())
  }

  /**
   * Get enhanced rate limits for a provider
   * @param providerType - Provider type
   * @returns Enhanced rate limits or null
   */
  getEnhancedLimits(providerType: IntegrationProviderType): EnhancedRateLimits | null {
    return this.config.get(providerType) || null
  }

  /**
   * Update configuration for a provider
   * @param providerType - Provider type
   * @param limits - New rate limits
   */
  updateConfig(providerType: IntegrationProviderType, limits: Partial<EnhancedRateLimits>): void {
    const existing = this.config.get(providerType) || {}
    this.config.set(providerType, { ...existing, ...limits })

    this.logger.info('Updated rate limit configuration', {
      provider: providerType,
      limits,
    })
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config.clear()
    this.loadDefaults()
    this.loadEnvironmentOverrides()

    this.logger.info('Rate limiter configuration reset to defaults')
  }

  /**
   * Export configuration as JSON
   * @returns Configuration object
   */
  export(): Record<string, any> {
    const result: Record<string, any> = {
      enabled: this.isRateLimitingEnabled(),
      metricsEnabled: this.isMetricsEnabled(),
      coalescingEnabled: this.isCoalescingEnabled(),
      coalescingWindow: this.getCoalescingWindow(),
      providers: {},
    }

    for (const [provider, limits] of Array.from(this.config.entries())) {
      result.providers[provider] = limits
    }

    return result
  }
}

// Singleton instance
let configManager: RateLimiterConfigManager | null = null

/**
 * Get the global configuration manager instance
 * @returns Configuration manager instance
 */
export function getConfigManager(): RateLimiterConfigManager {
  if (!configManager) {
    configManager = new RateLimiterConfigManager()
  }
  return configManager
}

/**
 * Create a throttler for a specific provider
 * @param providerType - Provider type
 * @returns Configured UniversalThrottler instance
 */
export async function createThrottlerForProvider(
  providerType: IntegrationProviderType
): Promise<import('./universal-throttler').UniversalThrottler> {
  const { UniversalThrottler } = await import('./universal-throttler')
  const manager = getConfigManager()
  const config = manager.getThrottlerConfig(providerType)

  const throttler = new UniversalThrottler(config)
  await throttler.init()

  return throttler
}

// packages/lib/src/utils/rate-limiter/provider-configs.ts

import { IntegrationProviderType as IntegrationProviderTypeEnum } from '@auxx/database/enums'
import type { IntegrationProviderType } from '@auxx/database/types'
import { getProviderCapabilities } from '../../providers/provider-capabilities'
import type { EnhancedRateLimits, RetryConfig } from './types'

/**
 * Default retry configuration for all providers
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 60000, // 1 minute
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
    'rate limit',
    'quota exceeded',
    'too many requests',
    'throttled',
    '429',
    '503',
    '502',
    '504',
  ],
}

/**
 * Gmail quota unit costs for different operations
 * Based on Gmail API documentation
 */
export const GMAIL_QUOTA_COSTS = {
  'messages.get': 5,
  'messages.list': 5,
  'messages.send': 100,
  'messages.modify': 5,
  'messages.batchGet': 50,
  'messages.batchModify': 50,
  'messages.import': 250,
  'messages.insert': 250,
  'messages.delete': 10,
  'messages.trash': 5,
  'messages.untrash': 5,
  'threads.get': 10,
  'threads.list': 10,
  'threads.modify': 5,
  'threads.delete': 20,
  'threads.trash': 10,
  'threads.untrash': 10,
  'drafts.create': 10,
  'drafts.update': 15,
  'drafts.send': 100,
  'labels.create': 5,
  'labels.update': 5,
  'labels.list': 1,
  'users.watch': 100,
  'users.stop': 10,
  'history.list': 2,
} as const

/**
 * Enhanced rate limits for providers
 * These extend the basic capabilities with more detailed limits
 */
export const ENHANCED_PROVIDER_LIMITS: Partial<
  Record<IntegrationProviderType, EnhancedRateLimits>
> = {
  [IntegrationProviderTypeEnum.google]: {
    // Gmail specific limits (extending existing capabilities)
    requestsPerSecond: 250, // 250 quota units/sec
    requestsPerMinute: 15000, // 15k quota units/min per user
    burstLimit: 100, // Max burst requests
    concurrentRequests: 50, // Max concurrent API calls
    batchSize: 100, // Max items per batch request

    // Context-specific limits for different operations
    contexts: {
      // Message sync operations
      sync: {
        maxRequests: 100,
        perInterval: 60000, // per minute
        maxConcurrent: 10,
      },
      // Batch operations (fetching multiple messages)
      // Must have capacity >= batch cost (50 tokens per batch request)
      batch: {
        maxRequests: 100,
        perInterval: 1000, // per second - allows ~2 batch requests/sec
        maxConcurrent: 2,
      },
      // Sending messages
      send: {
        maxRequests: 250, // Higher limit for sending
        perInterval: 60000, // per minute
        maxConcurrent: 20,
      },
      // Webhook setup (watch) - allows multiple operations per day for cancel/re-subscribe
      webhook: {
        maxRequests: 5,
        perInterval: 86400000, // 5 webhook operations per day
      },
      // History sync
      history: {
        maxRequests: 200,
        perInterval: 60000,
        maxConcurrent: 5,
      },
      // Label operations
      labels: {
        maxRequests: 50,
        perInterval: 60000,
      },
    },
  },

  [IntegrationProviderTypeEnum.outlook]: {
    // Outlook/Microsoft Graph API limits
    requestsPerMinute: 1000, // Conservative estimate
    requestsPerHour: 10000, // 10k requests per 10 minutes
    burstLimit: 20,
    concurrentRequests: 10,
    batchSize: 20, // Microsoft Graph batch limit

    contexts: {
      sync: {
        maxRequests: 20,
        perInterval: 60000,
      },
      batch: {
        maxRequests: 4,
        perInterval: 1000,
      },
      send: {
        maxRequests: 100,
        perInterval: 60000,
      },
      delta: {
        maxRequests: 100,
        perInterval: 60000,
      },
      subscriptions: {
        maxRequests: 10,
        perInterval: 3600000, // per hour
      },
    },
  },

  [IntegrationProviderTypeEnum.facebook]: {
    // Facebook Graph API limits
    requestsPerMinute: 200,
    requestsPerHour: 1000,
    concurrentRequests: 5,
    batchSize: 50,

    contexts: {
      messages: {
        maxRequests: 200,
        perInterval: 3600000, // per hour
      },
      send: {
        maxRequests: 50,
        perInterval: 60000,
      },
      conversations: {
        maxRequests: 100,
        perInterval: 60000,
      },
      insights: {
        maxRequests: 200,
        perInterval: 3600000,
      },
    },
  },

  [IntegrationProviderTypeEnum.openphone]: {
    // OpenPhone API limits
    requestsPerMinute: 100,
    requestsPerHour: 1000,
    concurrentRequests: 5,
    batchSize: 10,

    contexts: {
      messages: {
        maxRequests: 100,
        perInterval: 60000,
      },
      send: {
        maxRequests: 30,
        perInterval: 60000,
      },
      calls: {
        maxRequests: 50,
        perInterval: 60000,
      },
    },
  },

  [IntegrationProviderTypeEnum.telegram]: {
    // Telegram Bot API limits
    requestsPerSecond: 30, // 30 messages per second per bot
    requestsPerMinute: 1000,
    concurrentRequests: 10,
    batchSize: 100,

    contexts: {
      messages: {
        maxRequests: 30,
        perInterval: 1000,
      },
      bulk: {
        maxRequests: 20, // Bulk notifications
        perInterval: 60000,
      },
      media: {
        maxRequests: 10,
        perInterval: 1000,
      },
    },
  },

  [IntegrationProviderTypeEnum.shopify]: {
    // Shopify API limits (REST)
    requestsPerSecond: 2, // 2 requests per second
    requestsPerMinute: 40, // Leaky bucket: 40 requests per minute
    burstLimit: 40,
    concurrentRequests: 5,

    contexts: {
      graphql: {
        maxRequests: 1000, // 1000 cost points
        perInterval: 1000, // per second
      },
      rest: {
        maxRequests: 2,
        perInterval: 1000,
      },
      webhooks: {
        maxRequests: 10,
        perInterval: 60000,
      },
      bulk: {
        maxRequests: 10,
        perInterval: 60000,
      },
    },
  },

  [IntegrationProviderTypeEnum.sendgrid]: {
    // SendGrid API limits
    requestsPerSecond: 600,
    requestsPerMinute: 3000,
    concurrentRequests: 10,
    batchSize: 1000, // Batch send limit

    contexts: {
      send: {
        maxRequests: 600,
        perInterval: 1000,
      },
      batch: {
        maxRequests: 100,
        perInterval: 60000,
      },
      stats: {
        maxRequests: 100,
        perInterval: 60000,
      },
    },
  },
}

/**
 * Get merged rate limit configuration for a provider
 * Combines base capabilities with enhanced limits
 */
export function getMergedProviderLimits(providerType: IntegrationProviderType): EnhancedRateLimits {
  const baseCapabilities = getProviderCapabilities(providerType)
  const enhancedLimits = ENHANCED_PROVIDER_LIMITS[providerType] || {}

  return {
    // Base limits from capabilities
    messagesPerMinute: baseCapabilities.rateLimits?.messagesPerMinute,
    messagesPerHour: baseCapabilities.rateLimits?.messagesPerHour,
    messagesPerDay: baseCapabilities.rateLimits?.messagesPerDay,

    // Enhanced limits
    ...enhancedLimits,
  }
}

/**
 * Get rate limit configuration for a specific context
 */
export function getContextLimits(
  providerType: IntegrationProviderType,
  context: string
): {
  maxRequests: number
  perInterval: number
  maxConcurrent?: number
} | null {
  const providerLimits = ENHANCED_PROVIDER_LIMITS[providerType]
  if (!providerLimits?.contexts) {
    return null
  }

  return providerLimits.contexts[context] || null
}

/**
 * Get Gmail quota cost for an operation
 */
export function getGmailQuotaCost(operation: string): number {
  return GMAIL_QUOTA_COSTS[operation as keyof typeof GMAIL_QUOTA_COSTS] || 1
}

/**
 * Check if a provider supports rate limiting
 */
export function supportsRateLimiting(providerType: IntegrationProviderType): boolean {
  return providerType in ENHANCED_PROVIDER_LIMITS
}

/**
 * Get default rate limit for unknown providers
 */
export function getDefaultRateLimits(): EnhancedRateLimits {
  return {
    requestsPerMinute: 100,
    requestsPerHour: 1000,
    concurrentRequests: 10,
    burstLimit: 20,
    batchSize: 10,
  }
}

// packages/redis/src/providers/provider-detector.ts
import { env } from '@auxx/config/server'
import { logger, type RedisProvider, type RedisProviderCapabilities } from '../types'

/**
 * Automatic provider detection based on environment variables
 */
export function detectRedisProvider(): RedisProvider {
  // Check for Upstash configuration
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    logger.info('Detected Upstash Redis provider via KV_REST_API_URL and KV_REST_API_TOKEN')
    return 'upstash'
  }

  // Check for AWS ElastiCache configuration
  if (env.ELASTICACHE_URL) {
    logger.info('Detected AWS ElastiCache Redis provider via ELASTICACHE_URL')
    return 'aws'
  }

  // Check for hosted Redis configuration
  if (env.REDIS_HOST) {
    logger.info('Detected hosted Redis provider via REDIS_HOST')
    return 'hosted'
  }

  logger.warn('No specific Redis configuration detected, defaulting to hosted provider')
  return 'hosted'
}

/**
 * Get Redis provider from environment variable or auto-detect
 */
export function getRedisProvider(): RedisProvider {
  if (env.CACHE_PROVIDER) {
    const envProvider = env.CACHE_PROVIDER.toLowerCase()

    // Validate the provider value
    if (isValidRedisProvider(envProvider)) {
      logger.info(`Using Redis provider from CACHE_PROVIDER: ${envProvider}`)
      return envProvider
    } else {
      logger.warn(
        `Invalid CACHE_PROVIDER value "${env.CACHE_PROVIDER}", falling back to auto-detection`
      )
    }
  }

  return detectRedisProvider()
}

/**
 * Check if a string is a valid Redis provider
 */
export function isValidRedisProvider(provider: string): provider is RedisProvider {
  return provider === 'upstash' || provider === 'aws' || provider === 'hosted'
}

/**
 * Get provider capabilities based on provider type
 */
export function getProviderCapabilities(provider: RedisProvider): RedisProviderCapabilities {
  switch (provider) {
    case 'upstash':
      return {
        provider: 'upstash',
        nativePubSub: false,
        patternSubscribe: false,
        transactions: false,
        sortedSets: true,
        connectionType: 'HTTP',
        requiresPolling: true,
        supportedOperations: [
          'get',
          'set',
          'setex',
          'del',
          'exists',
          'expire',
          'ping',
          'quit',
          'keys',
          'rpop',
          'lpush',
          'llen',
          'publish',
          'zadd',
          'zrem',
          'zrevrange',
          'zcard',
          'zrank',
          'zrevrank',
          'zscore',
          'ttl',
          'pttl',
        ],
      }

    case 'aws':
      return {
        provider: 'aws',
        nativePubSub: true,
        patternSubscribe: true,
        transactions: true,
        sortedSets: true,
        connectionType: 'TCP',
        requiresPolling: false,
        supportedOperations: [
          'get',
          'set',
          'setex',
          'del',
          'exists',
          'expire',
          'ping',
          'quit',
          'publish',
          'subscribe',
          'unsubscribe',
          'psubscribe',
          'punsubscribe',
          'keys',
          'rpop',
          'lpush',
          'llen',
          'on',
          'removeListener',
          'zadd',
          'zrem',
          'zrevrange',
          'zcard',
          'zrank',
          'zrevrank',
          'zscore',
          'ttl',
          'pttl',
        ],
      }

    case 'hosted':
      return {
        provider: 'hosted',
        nativePubSub: true,
        patternSubscribe: true,
        transactions: true,
        sortedSets: true,
        connectionType: 'TCP',
        requiresPolling: false,
        supportedOperations: [
          'get',
          'set',
          'setex',
          'del',
          'exists',
          'expire',
          'ping',
          'quit',
          'publish',
          'subscribe',
          'unsubscribe',
          'psubscribe',
          'punsubscribe',
          'keys',
          'rpop',
          'lpush',
          'llen',
          'on',
          'removeListener',
          'zadd',
          'zrem',
          'zrevrange',
          'zcard',
          'zrank',
          'zrevrank',
          'zscore',
          'ttl',
          'pttl',
        ],
      }

    default:
      throw new Error(
        `Unknown Redis provider: ${provider}. Valid providers are: upstash, aws, hosted`
      )
  }
}

/**
 * Validate environment configuration for a given provider
 */
export function validateProviderConfiguration(provider: RedisProvider): boolean {
  switch (provider) {
    case 'upstash':
      return !!(env.KV_REST_API_URL && env.KV_REST_API_TOKEN)

    case 'aws':
      return !!env.ELASTICACHE_URL

    case 'hosted':
      return !!env.REDIS_HOST

    default:
      return false
  }
}

/**
 * Get connection options for a given provider
 */
export function getConnectionOptions(provider?: RedisProvider) {
  const detectedProvider = provider ?? getRedisProvider()

  switch (detectedProvider) {
    case 'upstash':
      return {
        restApiUrl: env.KV_REST_API_URL,
        restApiToken: env.KV_REST_API_TOKEN,
        url: env.KV_URL,
      }

    case 'aws':
      return {
        url: env.ELASTICACHE_URL,
      }

    case 'hosted':
      return {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT ? parseInt(env.REDIS_PORT, 10) : 6379,
        password: env.REDIS_PASSWORD,
      }

    default:
      throw new Error(`Cannot get connection options for unknown provider: ${detectedProvider}`)
  }
}

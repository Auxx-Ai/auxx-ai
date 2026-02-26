// packages/redis/src/core/redis-client-factory.ts

import { createIORedisClient } from '../providers/ioredis-provider'
import {
  getConnectionOptions,
  getProviderCapabilities,
  getRedisProvider,
  validateProviderConfiguration,
} from '../providers/provider-detector'
import { createUpstashClient } from '../providers/upstash-provider'
import {
  logger,
  type RedisClient,
  type RedisProvider,
  type RedisProviderCapabilities,
} from '../types'

/** Timeout for connection verification pings (ms) */
const PING_TIMEOUT_MS = 5_000

/**
 * Race a promise against a timeout. Rejects with a clear message if the
 * timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Factory pattern for creating Redis clients
 * Provides provider-agnostic client creation with automatic capability detection
 */
export class RedisClientFactory {
  private static instances = new Map<string, RedisClient>()

  /**
   * Returns true when REDIS_PASSWORD is not set as a non-empty environment variable.
   */
  private static isHostedRedisPasswordMissing(): boolean {
    return !(process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== '')
  }

  /**
   * Normalizes hosted NOAUTH errors into an actionable configuration message.
   */
  private static toConnectionError(provider: RedisProvider, error: unknown): Error {
    const errorMessage = (error as Error).message
    if (
      provider === 'hosted' &&
      errorMessage.includes('NOAUTH Authentication required') &&
      RedisClientFactory.isHostedRedisPasswordMissing()
    ) {
      return new Error(
        'Redis connection failed for hosted: NOAUTH Authentication required. REDIS_PASSWORD is missing or empty.'
      )
    }

    return new Error(`Redis connection failed for ${provider}: ${errorMessage}`)
  }

  /**
   * Create a Redis client instance
   * @param provider - Optional provider override
   * @param instanceId - Optional instance identifier for multiple clients
   * @returns Redis client instance
   */
  static async createClient(
    provider?: RedisProvider,
    instanceId = 'default'
  ): Promise<RedisClient> {
    const cacheKey = `${provider ?? 'auto'}-${instanceId}`

    // Return existing instance if available (no ping — verified on creation)
    if (RedisClientFactory.instances.has(cacheKey)) {
      return RedisClientFactory.instances.get(cacheKey)!
    }

    const detectedProvider = provider ?? getRedisProvider()
    logger.info(`Creating new Redis client instance: ${cacheKey} (provider: ${detectedProvider})`)

    // Validate provider configuration
    if (!validateProviderConfiguration(detectedProvider)) {
      throw new Error(`Invalid configuration for Redis provider: ${detectedProvider}`)
    }

    let client: RedisClient

    // Create client based on provider
    switch (detectedProvider) {
      case 'upstash':
        client = createUpstashClient()
        break
      case 'aws':
        client = createIORedisClient('aws')
        break
      case 'hosted':
        client = createIORedisClient('hosted')
        break
      default:
        throw new Error(`Unsupported Redis provider: ${detectedProvider}`)
    }

    // Establish connection and verify with ping (with timeouts to prevent hanging on Lambda/serverless)
    try {
      await withTimeout(client.connect(), PING_TIMEOUT_MS, `Redis connect (${cacheKey})`)
      await withTimeout(client.ping(), PING_TIMEOUT_MS, `Redis ping (${cacheKey})`)
      logger.info(`Redis client ${cacheKey} connection successful`)
    } catch (error) {
      logger.error(`Redis client ${cacheKey} connection failed`, {
        error: (error as Error).message,
      })
      // Force-close the client so it doesn't leak
      try {
        client.disconnect()
      } catch {}
      throw RedisClientFactory.toConnectionError(detectedProvider, error)
    }

    // Cache the instance
    RedisClientFactory.instances.set(cacheKey, client)
    return client
  }

  /**
   * Create a dedicated client that won't be cached
   * Useful for specialized use cases like pub/sub
   */
  static async createDedicatedClient(provider?: RedisProvider): Promise<RedisClient> {
    const detectedProvider = provider ?? getRedisProvider()
    logger.info(`Creating dedicated Redis client (provider: ${detectedProvider})`)

    // Validate provider configuration
    if (!validateProviderConfiguration(detectedProvider)) {
      throw new Error(`Invalid configuration for Redis provider: ${detectedProvider}`)
    }

    let client: RedisClient

    // Create client based on provider
    switch (detectedProvider) {
      case 'upstash':
        client = createUpstashClient()
        break
      case 'aws':
        client = createIORedisClient('aws')
        break
      case 'hosted':
        client = createIORedisClient('hosted')
        break
      default:
        throw new Error(`Unsupported Redis provider: ${detectedProvider}`)
    }

    // Establish connection and verify with ping (with timeouts to prevent hanging on Lambda/serverless)
    try {
      await withTimeout(client.connect(), PING_TIMEOUT_MS, `Redis connect (dedicated)`)
      await withTimeout(client.ping(), PING_TIMEOUT_MS, `Redis ping (dedicated)`)
      logger.info(`Dedicated Redis client connection successful`)
    } catch (error) {
      logger.error(`Dedicated Redis client connection failed`, { error: (error as Error).message })
      try {
        client.disconnect()
      } catch {}
      throw RedisClientFactory.toConnectionError(detectedProvider, error)
    }

    return client
  }

  /**
   * Get provider capabilities for current or specified provider
   */
  static getCapabilities(provider?: RedisProvider): RedisProviderCapabilities {
    const detectedProvider = provider ?? getRedisProvider()
    return getProviderCapabilities(detectedProvider)
  }

  /**
   * Test connection to Redis provider
   */
  static async testConnection(provider?: RedisProvider): Promise<boolean> {
    try {
      const client = await RedisClientFactory.createDedicatedClient(provider)
      await client.ping()
      await client.quit()
      return true
    } catch (error) {
      logger.error('Redis connection test failed', { error: (error as Error).message })
      return false
    }
  }

  /**
   * Close all cached client instances
   */
  static async closeAllClients(): Promise<void> {
    const promises = Array.from(RedisClientFactory.instances.entries()).map(
      async ([key, client]) => {
        try {
          await client.quit()
          logger.info(`Closed Redis client: ${key}`)
        } catch (error) {
          logger.error(`Error closing Redis client ${key}`, { error: (error as Error).message })
          // Force disconnect if quit fails
          if (client.disconnect) {
            client.disconnect()
          }
        }
      }
    )

    await Promise.all(promises)
    RedisClientFactory.instances.clear()
    logger.info('All Redis client instances closed')
  }

  /**
   * Remove a specific client instance
   */
  static async closeClient(instanceId = 'default', provider?: RedisProvider): Promise<void> {
    const cacheKey = `${provider ?? 'auto'}-${instanceId}`
    const client = RedisClientFactory.instances.get(cacheKey)

    if (client) {
      try {
        await client.quit()
        logger.info(`Closed Redis client: ${cacheKey}`)
      } catch (error) {
        logger.error(`Error closing Redis client ${cacheKey}`, { error: (error as Error).message })
        if (client.disconnect) {
          client.disconnect()
        }
      }
      RedisClientFactory.instances.delete(cacheKey)
    }
  }

  /**
   * Get current provider information
   */
  static getProviderInfo(): {
    provider: RedisProvider
    capabilities: RedisProviderCapabilities
    connectionOptions: any
  } {
    const provider = getRedisProvider()
    const capabilities = getProviderCapabilities(provider)
    const connectionOptions = getConnectionOptions(provider)

    return {
      provider,
      capabilities,
      connectionOptions,
    }
  }
}

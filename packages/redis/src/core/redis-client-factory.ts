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

/**
 * Factory pattern for creating Redis clients
 * Provides provider-agnostic client creation with automatic capability detection
 */
export class RedisClientFactory {
  private static instances = new Map<string, RedisClient>()

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

    // Return existing instance if available
    if (RedisClientFactory.instances.has(cacheKey)) {
      const existingClient = RedisClientFactory.instances.get(cacheKey)!
      try {
        // Test if connection is still alive
        await existingClient.ping()
        return existingClient
      } catch (error) {
        logger.warn(`Existing Redis client ${cacheKey} failed ping, creating new instance`, {
          error: (error as Error).message,
        })
        // Remove failed instance
        RedisClientFactory.instances.delete(cacheKey)
      }
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

    // Test connection
    try {
      await client.ping()
      logger.info(`Redis client ${cacheKey} connection successful`)
    } catch (error) {
      logger.error(`Redis client ${cacheKey} connection failed`, {
        error: (error as Error).message,
      })
      throw new Error(
        `Redis connection failed for ${detectedProvider}: ${(error as Error).message}`
      )
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

    // Test connection
    try {
      await client.ping()
      logger.info(`Dedicated Redis client connection successful`)
    } catch (error) {
      logger.error(`Dedicated Redis client connection failed`, { error: (error as Error).message })
      throw new Error(
        `Redis connection failed for ${detectedProvider}: ${(error as Error).message}`
      )
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

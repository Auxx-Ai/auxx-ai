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
 * Client caches live on `globalThis`, not in module scope.
 *
 * Next.js/Turbopack gives server components, route handlers, and API routes
 * separate module scopes within the same Node process. A module-level `Map`
 * is therefore duplicated per scope, and each fresh copy starts empty — so
 * every scope opens its own set of connections to the same Redis. `globalThis`
 * is process-wide and survives HMR, so all scopes share one pool.
 * (`@auxx/lib/cache` singletons use the same approach for the same reason.)
 */
const globalForRedis = globalThis as unknown as {
  _auxxRedisInstances?: Map<string, RedisClient>
  _auxxRedisPending?: Map<string, Promise<RedisClient>>
}

/** Connected, reusable clients keyed by `<provider>-<instanceId>` */
const instances = (globalForRedis._auxxRedisInstances ??= new Map<string, RedisClient>())

/**
 * Creations currently in flight, keyed the same way. Entries are removed as
 * soon as the creation settles — this only coalesces concurrent callers, it
 * never caches a result.
 */
const pending = (globalForRedis._auxxRedisPending ??= new Map<string, Promise<RedisClient>>())

/**
 * Factory pattern for creating Redis clients
 * Provides provider-agnostic client creation with automatic capability detection
 */
export class RedisClientFactory {
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

    // Return existing instance if it's still alive. A previous caller may have
    // closed the connection (e.g. an SSE route calling .quit() on the shared
    // singleton); without this check we'd hand back a dead client forever.
    const cached = instances.get(cacheKey)
    if (cached) {
      if (cached.isAlive()) {
        return cached
      }
      logger.warn(`Cached Redis client ${cacheKey} is no longer alive; recreating`)
      instances.delete(cacheKey)
    }

    // Coalesce concurrent creations for the same key. `instances` is only
    // populated after connect+ping resolve, so callers arriving during that
    // window would all miss the cache and each build their own client — every
    // one but the last then orphaned, holding an open socket that nothing ever
    // closes. Four cache services constructed in one tick reliably hit this.
    const inFlight = pending.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    // Must be registered before the first await so no caller can interleave.
    const creation = RedisClientFactory.connectNewClient(cacheKey, provider).finally(() => {
      pending.delete(cacheKey)
    })
    pending.set(cacheKey, creation)
    return creation
  }

  /**
   * Build, connect, verify, and cache a single client. Always call via
   * `createClient` — this deliberately has no cache or dedupe of its own.
   */
  private static async connectNewClient(
    cacheKey: string,
    provider?: RedisProvider
  ): Promise<RedisClient> {
    const detectedProvider = provider ?? getRedisProvider()
    logger.info(`Creating new Redis client instance: ${cacheKey} (provider: ${detectedProvider})`)

    // Validate provider configuration
    if (!validateProviderConfiguration(detectedProvider)) {
      throw new Error(`Invalid configuration for Redis provider: ${detectedProvider}`)
    }

    let client: RedisClient

    // Eviction callback — when the underlying socket ends, drop the cached
    // reference so the next caller creates a fresh client.
    const evict = () => {
      if (instances.get(cacheKey) === client) {
        instances.delete(cacheKey)
      }
    }

    // Create client based on provider
    switch (detectedProvider) {
      case 'upstash':
        client = createUpstashClient()
        break
      case 'aws':
        client = createIORedisClient('aws', evict)
        break
      case 'hosted':
        client = createIORedisClient('hosted', evict)
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
    instances.set(cacheKey, client)
    return client
  }

  /**
   * Return the cached client for an instance id if one is connected and alive.
   * Never creates a connection — callers use this to test for an existing
   * client without triggering one.
   */
  static getLiveClient(instanceId = 'default', provider?: RedisProvider): RedisClient | undefined {
    const client = instances.get(`${provider ?? 'auto'}-${instanceId}`)
    return client?.isAlive() ? client : undefined
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
    const promises = Array.from(instances.entries()).map(async ([key, client]) => {
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
    })

    await Promise.all(promises)
    instances.clear()
    logger.info('All Redis client instances closed')
  }

  /**
   * Remove a specific client instance
   */
  static async closeClient(instanceId = 'default', provider?: RedisProvider): Promise<void> {
    const cacheKey = `${provider ?? 'auto'}-${instanceId}`
    const client = instances.get(cacheKey)

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
      instances.delete(cacheKey)
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

// packages/redis/src/client.ts
import { configService } from '@auxx/credentials'
import { RedisClientFactory } from './core/redis-client-factory'
import { parseRedisUrl, type RedisUrlComponents } from './parse-redis-url'
import { logger, type RedisClient } from './types'

// Channel prefixes
export const CHANNELS = {
  CHAT_MESSAGE: 'chat:message:',
  CHAT_TYPING: 'chat:typing:',
  CHAT_SESSION: 'chat:session:',
  AGENT_NOTIFICATION: 'agent:notification:',
}

// Redis key prefixes
export const KEYS = {
  SESSION: 'session:',
  SESSION_MESSAGES: 'session:messages:',
  SESSION_LIST: 'org:sessions:',
  USER_INFO: 'user:',
}

// Message expiration in Redis (7 days in seconds)
export const MESSAGE_EXPIRATION = 60 * 60 * 24 * 7
// Session expiration in Redis (30 days in seconds)
export const SESSION_EXPIRATION = 60 * 60 * 24 * 30

// Main Redis client singleton
let redisClient: RedisClient | null = null

// Publishing Redis client singleton (separate from subscriber client)
let publishingClient: RedisClient | null = null

// Subscription Redis client singleton (separate from publishing client)
let subscriptionClient: RedisClient | null = null

/**
 * Detect which Redis provider to use based on environment variables
 */
export function detectRedisProvider(): 'upstash' | 'aws' | 'hosted' {
  // Only access environment variables when function is called
  if (
    configService.get<string>('KV_REST_API_URL') &&
    configService.get<string>('KV_REST_API_TOKEN')
  ) {
    return 'upstash'
  } else if (configService.get<string>('ELASTICACHE_URL')) {
    return 'aws'
  } else if (configService.get<string>('REDIS_HOST')) {
    return 'hosted'
  }

  logger.warn('No specific Redis configuration detected, defaulting to hosted')
  return 'hosted'
}

export function getRedisProvider(): 'upstash' | 'aws' | 'hosted' {
  const cacheProvider = configService.get<string>('CACHE_PROVIDER')
  if (cacheProvider) {
    return cacheProvider as 'upstash' | 'aws' | 'hosted'
  }
  return detectRedisProvider()
}

type RedisConnectionOptions = Pick<RedisUrlComponents, 'host' | 'password' | 'port'>

export const WORKER_CONNECTION_CONFIG: RedisConnectionOptions = {
  host: configService.get<string>('REDIS_HOST')!,
  port: configService.get<number>('REDIS_PORT')!,
  password: configService.get<string>('REDIS_PASSWORD')!,
}

export function getConnectionOptions() {
  const provider = getRedisProvider()

  let connectionConfig: RedisConnectionOptions
  switch (provider) {
    case 'upstash': {
      const { host, password, port } = parseRedisUrl(configService.get<string>('KV_URL')!)
      connectionConfig = { host, password, port }
      break
    }
    default: {
      connectionConfig = WORKER_CONNECTION_CONFIG
    }
  }
  return connectionConfig
}

/**
 * Get a Redis client instance (creates a singleton)
 * @param {boolean} required - If true, will throw error when connection fails
 * @returns {Promise<RedisClient|null>} - Redis client or null if not required and connection fails
 */
export async function getRedisClient(required = true): Promise<RedisClient | undefined> {
  try {
    if (!redisClient) {
      // Use the new factory to create the client
      redisClient = await RedisClientFactory.createClient(undefined, 'main')
    }

    return redisClient
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error: (error as Error).message })

    if (required) {
      throw new Error(`Redis connection required but failed: ${(error as Error).message}`)
    }

    // Return null if Redis is optional
    return undefined
  }
}

/**
 * Get a separate Redis client for publishing (not subscriber mode)
 * This prevents conflicts when the main client is used for subscriptions
 */
export async function getPublishingClient(required = true): Promise<RedisClient | null> {
  try {
    if (!publishingClient) {
      // Use the new factory to create the publishing client
      publishingClient = await RedisClientFactory.createClient(undefined, 'publishing')
    }

    return publishingClient
  } catch (error) {
    logger.error('Failed to initialize Redis publishing client', {
      error: (error as Error).message,
    })

    if (required) {
      throw new Error(
        `Redis publishing client connection required but failed: ${(error as Error).message}`
      )
    }

    return null
  }
}

/**
 * Get a separate Redis client for subscriptions (not publishing mode)
 * This prevents conflicts when the publishing client is used for regular operations
 */
export async function getSubscriptionClient(required = true): Promise<RedisClient | null> {
  try {
    if (!subscriptionClient) {
      // Use the new factory to create the subscription client
      subscriptionClient = await RedisClientFactory.createClient(undefined, 'subscription')
    }

    return subscriptionClient
  } catch (error) {
    logger.error('Failed to initialize Redis subscription client', {
      error: (error as Error).message,
    })

    if (required) {
      throw new Error(
        `Redis subscription client connection required but failed: ${(error as Error).message}`
      )
    }

    return null
  }
}

/**
 * Disconnect Redis client (useful for serverless environments)
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit()
      logger.info('Redis connection properly closed')
      redisClient = null
    } catch (err) {
      logger.error('Error disconnecting from Redis', { error: (err as Error).message })
      // Force disconnect if quit fails
      if (redisClient?.disconnect) {
        redisClient.disconnect()
        redisClient = null
      }
    }
  }

  if (publishingClient) {
    try {
      await publishingClient.quit()
      logger.info('Redis publishing client connection properly closed')
      publishingClient = null
    } catch (err) {
      logger.error('Error disconnecting from Redis publishing client', {
        error: (err as Error).message,
      })
      if (publishingClient?.disconnect) {
        publishingClient.disconnect()
        publishingClient = null
      }
    }
  }

  if (subscriptionClient) {
    try {
      await subscriptionClient.quit()
      logger.info('Redis subscription client connection properly closed')
      subscriptionClient = null
    } catch (err) {
      logger.error('Error disconnecting from Redis subscription client', {
        error: (err as Error).message,
      })
      if (subscriptionClient?.disconnect) {
        subscriptionClient.disconnect()
        subscriptionClient = null
      }
    }
  }

  // Also close all factory clients
  await RedisClientFactory.closeAllClients()
}

/**
 * Create a dedicated Redis client that won't be cached
 * Useful for specialized use cases like pub/sub
 */
export async function createDedicatedClient(): Promise<RedisClient> {
  return await RedisClientFactory.createDedicatedClient()
}

/**
 * Get current provider capabilities
 */
export function getRedisCapabilities() {
  return RedisClientFactory.getCapabilities()
}

/**
 * Store data in Redis with optional expiration
 */
export async function setRedisData(
  key: string,
  data: any,
  expirationSeconds?: number,
  required = false
): Promise<string | null> {
  try {
    const client = await getRedisClient(required)
    if (!client) return null

    const dataStr = typeof data === 'string' ? data : JSON.stringify(data)

    if (expirationSeconds) {
      return await client.setex(key, expirationSeconds, dataStr)
    } else {
      return await client.set(key, dataStr)
    }
  } catch (error) {
    logger.error('Failed to set Redis data', { key, error: (error as Error).message })

    if (required) throw error
    return null
  }
}

/**
 * Get data from Redis
 */
export async function getRedisData(key: string, required = false): Promise<any> {
  try {
    const client = await getRedisClient(required)
    if (!client) return null

    const data = await client.get(key)
    if (!data) return null

    try {
      return JSON.parse(data)
    } catch (error) {
      return data
    }
  } catch (error) {
    logger.error('Failed to get Redis data', { key, error: (error as Error).message })

    if (required) throw error
    return null
  }
}

/**
 * Delete data from Redis
 */
export async function deleteRedisData(key: string, required = false): Promise<number | null> {
  try {
    const client = await getRedisClient(required)
    if (!client) return null

    return await client.del(key)
  } catch (error) {
    logger.error('Failed to delete Redis data', { key, error: (error as Error).message })

    if (required) throw error
    return null
  }
}

/**
 * Close Redis client (useful for testing and cleanup)
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit()
    } catch (error) {
      logger.error('Error closing Redis connection', { error: (error as Error).message })
    } finally {
      redisClient = null
    }
  }
}

/**
 * Check if Redis is available
 * Useful for health checks or conditional feature enabling
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient(false)
    if (!client) return false

    await client.ping()
    return true
  } catch (error) {
    return false
  }
}

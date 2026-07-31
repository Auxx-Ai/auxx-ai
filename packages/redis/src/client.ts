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

/**
 * The main/publishing/subscription clients are cached by `RedisClientFactory`
 * under the instance ids below. This module deliberately keeps no client
 * references of its own: a second cache layer here would shadow the factory's,
 * go stale independently, and reintroduce the duplicate-connection problem it
 * exists to prevent.
 */
const MAIN_INSTANCE = 'main'
const PUBLISHING_INSTANCE = 'publishing'
const SUBSCRIPTION_INSTANCE = 'subscription'

// Connection failure cooldown — prevents retrying a 5s timeout on every call
// during the same Lambda invocation when Redis is unreachable. On globalThis
// for the same reason the factory's caches are: module scope is duplicated
// per Next.js server bundle, so a module-level counter wouldn't be shared.
const globalForCooldown = globalThis as unknown as { _auxxRedisLastFailureAt?: number }
const CONNECTION_FAILURE_COOLDOWN_MS = 30_000

/**
 * Read a raw environment variable without config defaults.
 */
function getExplicitEnv(key: string): string | undefined {
  const value = process.env[key]
  return value && value.trim() !== '' ? value : undefined
}

/**
 * Detect which Redis provider to use based on environment variables
 */
export function detectRedisProvider(): 'upstash' | 'aws' | 'hosted' {
  // Only access environment variables when function is called
  if (getExplicitEnv('KV_REST_API_URL') && getExplicitEnv('KV_REST_API_TOKEN')) {
    return 'upstash'
  } else if (getExplicitEnv('ELASTICACHE_URL')) {
    return 'aws'
  } else if (getExplicitEnv('REDIS_HOST')) {
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

type RedisConnectionOptions = Pick<RedisUrlComponents, 'host' | 'password' | 'port'> & {
  tls?: Record<string, never>
}

export const WORKER_CONNECTION_CONFIG: RedisConnectionOptions = {
  host: configService.get<string>('REDIS_HOST')!,
  port: configService.get<number>('REDIS_PORT')!,
  password: configService.get<string>('REDIS_PASSWORD')!,
}

export function getConnectionOptions(): RedisConnectionOptions {
  const provider = getRedisProvider()
  const tls = !!configService.get<boolean>('ELASTICACHE_TLS')

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

  if (tls) {
    connectionConfig.tls = {}
  }

  return connectionConfig
}

/**
 * Get a Redis client instance (creates a singleton)
 * @param {boolean} required - If true, will throw error when connection fails
 * @returns {Promise<RedisClient|null>} - Redis client or null if not required and connection fails
 */
export async function getRedisClient(required?: true): Promise<RedisClient>
export async function getRedisClient(required: false): Promise<RedisClient | undefined>
export async function getRedisClient(required: boolean): Promise<RedisClient | undefined>
export async function getRedisClient(required = true): Promise<RedisClient | undefined> {
  // Fast-fail during cooldown period after a connection failure.
  // Prevents burning 5s per call when Redis is unreachable (e.g., Lambda cold start).
  const lastFailureAt = globalForCooldown._auxxRedisLastFailureAt ?? 0
  if (lastFailureAt > 0 && !RedisClientFactory.getLiveClient(MAIN_INSTANCE)) {
    const elapsed = Date.now() - lastFailureAt
    if (elapsed < CONNECTION_FAILURE_COOLDOWN_MS) {
      if (required) {
        throw new Error(
          `Redis connection recently failed (${Math.round(elapsed / 1000)}s ago), in ${Math.round((CONNECTION_FAILURE_COOLDOWN_MS - elapsed) / 1000)}s cooldown`
        )
      }
      return undefined
    }
  }

  try {
    // The factory returns its cached client, joins an in-flight creation, or
    // builds a new one — including dropping a dead client and reconnecting.
    const client = await RedisClientFactory.createClient(undefined, MAIN_INSTANCE)
    globalForCooldown._auxxRedisLastFailureAt = 0 // Reset on successful connection
    return client
  } catch (error) {
    globalForCooldown._auxxRedisLastFailureAt = Date.now()
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
    return await RedisClientFactory.createClient(undefined, PUBLISHING_INSTANCE)
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
    return await RedisClientFactory.createClient(undefined, SUBSCRIPTION_INSTANCE)
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
  // The main, publishing, and subscription clients are all factory-cached, so
  // this covers them along with any other instance ids.
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
  await RedisClientFactory.closeClient(MAIN_INSTANCE)
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

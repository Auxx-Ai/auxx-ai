// packages/redis/src/providers/ioredis-provider.ts

import { configService } from '@auxx/credentials'
import { Redis } from 'ioredis'
import { logger, type RedisClient } from '../types'

/**
 * Enhanced IORedis provider that supports all Redis operations
 * Used for AWS ElastiCache and hosted Redis instances
 */
export function createIORedisClient(provider: 'aws' | 'hosted'): RedisClient {
  let client: Redis

  if (provider === 'aws') {
    const url = configService.get<string>('ELASTICACHE_URL')
    const tls = !!configService.get<boolean>('ELASTICACHE_TLS')

    if (!url) {
      throw new Error('ELASTICACHE_URL environment variable is required for AWS ElastiCache')
    }

    logger.info('Creating AWS ElastiCache Redis client with enhanced support', {
      url: url ? `${url.substring(0, 20)}...` : 'undefined',
      tls,
      rawEnv: process.env.ELASTICACHE_TLS,
    })

    client = new Redis(url, {
      tls: tls ? {} : undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 5) return null // stop retrying after 5 attempts
        const delay = Math.min(2 ** times * 100, 5000)
        logger.warn(`AWS Redis reconnecting in ${delay}ms (attempt ${times})`)
        return delay
      },
      connectTimeout: 5000,
    })
  } else {
    // hosted
    const host = configService.get<string>('REDIS_HOST')
    const port = configService.get<number>('REDIS_PORT', 6379)
    const password = configService.get<string>('REDIS_PASSWORD')
    const hasExplicitPassword = !!process.env.REDIS_PASSWORD?.trim()

    if (!host) {
      throw new Error('REDIS_HOST environment variable is required for hosted Redis')
    }
    logger.info('Creating hosted Redis client with enhanced support', {
      host,
      port,
      tls: !!configService.get<boolean>('ELASTICACHE_TLS'),
      rawEnv: process.env.ELASTICACHE_TLS,
      hasPassword: hasExplicitPassword,
    })
    if (!hasExplicitPassword) {
      logger.warn(
        'REDIS_PASSWORD is not set for hosted Redis. If your Redis requires auth, connection will fail with NOAUTH.'
      )
    }
    const tls = !!configService.get<boolean>('ELASTICACHE_TLS')

    client = new Redis({
      tls: tls ? {} : undefined,
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 5) return null // stop retrying after 5 attempts
        const delay = Math.min(2 ** times * 100, 5000)
        logger.warn(`Hosted Redis reconnecting in ${delay}ms (attempt ${times})`)
        return delay
      },
      connectTimeout: 5000,
    })
  }

  // Set up event handlers
  client.on('error', (err) => {
    logger.error(`${provider} Redis client error`, { error: err.message })
  })

  client.on('reconnecting', () => {
    logger.warn(`${provider} Redis client reconnecting`)
  })

  client.on('connect', () => {
    logger.info(`${provider} Redis client connected`)
  })

  // Create enhanced client wrapper
  const enhancedClient: RedisClient = {
    // Standard Redis operations
    get: async (key: string) => await client.get(key),
    set: async (key: string, value: any, ...args: any[]) => await client.set(key, value, ...args),
    setex: async (key: string, seconds: number, value: string) =>
      await client.setex(key, seconds, value),
    del: async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return await client.del(...key)
      }
      return await client.del(key)
    },
    exists: async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return await client.exists(...key)
      }
      return await client.exists(key)
    },
    expire: async (key: string, seconds: number) => await client.expire(key, seconds),
    ping: async () => await client.ping(),
    quit: async () => await client.quit(),
    info: async (section?: string) => (section ? await client.info(section) : await client.info()),

    // Pub/Sub operations (supported by IORedis)
    publish: async (channel: string, message: string) =>
      (await client.publish(channel, message)) as number,
    subscribe: async (channel: string) => (await client.subscribe(channel)) as number,
    unsubscribe: async (channel: string) => (await client.unsubscribe(channel)) as number,
    psubscribe: async (pattern: string) => (await client.psubscribe(pattern)) as number,
    punsubscribe: async (pattern: string) => (await client.punsubscribe(pattern)) as number,

    // Connection lifecycle
    connect: async () => {
      await client.connect()
    },
    disconnect: () => client.disconnect(),

    // Event handling
    on: (event: string, listener: (...args: any[]) => void) => client.on(event, listener),
    removeListener: (event: string, listener: (...args: any[]) => void) =>
      client.removeListener(event, listener),

    // Additional operations for compatibility
    keys: async (pattern: string) => await client.keys(pattern),
    rpop: async (key: string) => await client.rpop(key),
    lpush: async (key: string, ...values: string[]) => await client.lpush(key, ...values),
    rpush: async (key: string, ...values: string[]) => await client.rpush(key, ...values),
    llen: async (key: string) => await client.llen(key),
    ltrim: async (key: string, start: number, stop: number) => await client.ltrim(key, start, stop),
    lrange: async (key: string, start: number, stop: number) =>
      await client.lrange(key, start, stop),

    // Cursor-based iteration
    scan: async (cursor: string, ...args: any[]) => await client.scan(cursor, ...args),

    // Set operations (fully supported by IORedis)
    sadd: async (key: string, ...members: string[]) =>
      (await client.sadd(key, ...members)) as number,
    srem: async (key: string, ...members: string[]) =>
      (await client.srem(key, ...members)) as number,
    smembers: async (key: string) => await client.smembers(key),
    spop: async (key: string, count?: number) => {
      if (count !== undefined) {
        return await client.spop(key, count)
      }
      return await client.spop(key)
    },
    scard: async (key: string) => (await client.scard(key)) as number,

    // Sorted set operations (fully supported by IORedis)
    zadd: async (key: string, ...args: any[]) => {
      if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'string') {
        // Simple case: zadd(key, score, member)
        return (await client.zadd(key, args[0], args[1])) as number
      } else {
        // Complex case: zadd(key, score1, member1, score2, member2, ...)
        return (await client.zadd(key, ...args)) as number
      }
    },
    zrem: async (key: string, ...members: string[]) =>
      (await client.zrem(key, ...members)) as number,
    zrevrange: async (key: string, start: number, stop: number) =>
      await client.zrevrange(key, start, stop),
    zcard: async (key: string) => (await client.zcard(key)) as number,
    zrank: async (key: string, member: string) =>
      (await client.zrank(key, member)) as number | null,
    zrevrank: async (key: string, member: string) =>
      (await client.zrevrank(key, member)) as number | null,
    zscore: async (key: string, member: string) =>
      (await client.zscore(key, member)) as string | null,

    // TTL operations (fully supported by IORedis)
    ttl: async (key: string) => (await client.ttl(key)) as number,
    pttl: async (key: string) => (await client.pttl(key)) as number,
  }

  logger.info(`Enhanced ${provider} Redis client created successfully`)
  return enhancedClient
}

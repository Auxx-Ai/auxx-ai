// packages/redis/src/providers/upstash-provider.ts

import { configService } from '@auxx/credentials'
import { Redis } from '@upstash/redis'
import { logger, type RedisClient } from '../types'

/**
 * Enhanced Upstash provider with additional operations for polling-based pub/sub
 * Upstash doesn't support native pub/sub, so we use lists as message queues
 */
export function createUpstashClient(): RedisClient {
  const restUrl = configService.get<string>('KV_REST_API_URL')
  const restToken = configService.get<string>('KV_REST_API_TOKEN')

  if (!restUrl || !restToken) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required for Upstash Redis')
  }

  logger.info('Creating enhanced Upstash Redis client')

  const upstashClient = new Redis({
    url: restUrl,
    token: restToken,
    // Add retry configuration
    retry: {
      retries: 3,
      backoff: (retryCount) => Math.min(1000 * 2 ** retryCount, 10000),
    },
  })

  // Create enhanced client wrapper
  const enhancedClient: RedisClient = {
    // Standard Redis operations
    get: async (key: string) => await upstashClient.get(key),

    set: async (key: string, value: any, ...args: any[]) => {
      if (args.length === 0) {
        return await upstashClient.set(key, value)
      }

      // Parse all options from args (handles NX, EX combinations)
      const options: { nx?: boolean; ex?: number } = {}
      for (let i = 0; i < args.length; i++) {
        if (args[i] === 'NX') options.nx = true
        if (args[i] === 'EX' && typeof args[i + 1] === 'number') {
          options.ex = args[i + 1]
          i++ // Skip the number
        }
      }

      if (Object.keys(options).length > 0) {
        // NX returns null if key exists, 'OK' if set
        return await upstashClient.set(key, value, options)
      }

      return await upstashClient.set(key, value)
    },

    setex: async (key: string, seconds: number, value: string) => {
      const result = await upstashClient.set(key, value, { ex: seconds })
      return result || 'OK'
    },

    del: async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return await upstashClient.del(...key)
      }
      return await upstashClient.del(key)
    },

    exists: async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return await upstashClient.exists(...key)
      }
      return await upstashClient.exists(key)
    },

    expire: async (key: string, seconds: number) => {
      return await upstashClient.expire(key, seconds)
    },

    ping: async () => {
      await upstashClient.ping()
      return 'PONG'
    },

    info: async () => {
      // Upstash REST API does not support the INFO command
      return ''
    },

    quit: async () => {
      logger.info('Disconnecting Upstash Redis client')
      // Upstash REST client doesn't need explicit disconnection
      return 'OK'
    },

    // Connection lifecycle
    connect: async () => {
      // No-op — Upstash uses stateless HTTP requests
    },
    disconnect: () => {
      logger.info('Force disconnecting Upstash Redis client')
      // No-op for REST client
    },

    // Publish operation (using lists as message queues)
    publish: async (channel: string, message: string) => {
      try {
        // Store message in a list for the channel
        const listKey = `events:${channel}`
        await upstashClient.lpush(listKey, message)

        // Set expiration on the list to prevent memory leaks (1 hour)
        await upstashClient.expire(listKey, 3600)

        logger.debug(`Published message to Upstash list: ${listKey}`)
        return 1 // Simulate return value (number of subscribers)
      } catch (error) {
        logger.error('Error publishing to Upstash', { channel, error: (error as Error).message })
        throw error
      }
    },

    // Additional operations for polling-based pub/sub
    keys: async (pattern: string) => {
      try {
        return await upstashClient.keys(pattern)
      } catch (error) {
        logger.error('Error getting keys from Upstash', {
          pattern,
          error: (error as Error).message,
        })
        throw error
      }
    },

    rpop: async (key: string) => {
      try {
        return await upstashClient.rpop(key)
      } catch (error) {
        logger.error('Error popping from Upstash list', { key, error: (error as Error).message })
        throw error
      }
    },

    lpush: async (key: string, ...values: string[]) => {
      try {
        return await upstashClient.lpush(key, ...values)
      } catch (error) {
        logger.error('Error pushing to Upstash list', { key, error: (error as Error).message })
        throw error
      }
    },

    rpush: async (key: string, ...values: string[]) => {
      try {
        return await upstashClient.rpush(key, ...values)
      } catch (error) {
        logger.error('Error rpush to Upstash list', { key, error: (error as Error).message })
        throw error
      }
    },

    llen: async (key: string) => {
      try {
        return await upstashClient.llen(key)
      } catch (error) {
        logger.error('Error getting list length from Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    ltrim: async (key: string, start: number, stop: number) => {
      try {
        return await upstashClient.ltrim(key, start, stop)
      } catch (error) {
        logger.error('Error trimming Upstash list', { key, error: (error as Error).message })
        throw error
      }
    },

    lrange: async (key: string, start: number, stop: number) => {
      try {
        return await upstashClient.lrange(key, start, stop)
      } catch (error) {
        logger.error('Error getting range from Upstash list', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    // Cursor-based iteration
    scan: async (cursor: string, ...args: any[]) => {
      try {
        // Parse args: MATCH pattern COUNT count
        let match: string | undefined
        let count: number | undefined

        for (let i = 0; i < args.length; i += 2) {
          if (args[i] === 'MATCH') match = args[i + 1]
          if (args[i] === 'COUNT') count = args[i + 1]
        }

        const result = await upstashClient.scan(Number(cursor), {
          match,
          count,
        })

        // Upstash returns [cursor, keys] - cursor is a number, convert to string
        return [String(result[0]), result[1]]
      } catch (error) {
        logger.error('Error scanning keys in Upstash', { error: (error as Error).message })
        throw error
      }
    },

    // Set operations
    sadd: async (key: string, ...members: string[]) => {
      try {
        return await upstashClient.sadd(key, ...members)
      } catch (error) {
        logger.error('Error adding to set in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    srem: async (key: string, ...members: string[]) => {
      try {
        return await upstashClient.srem(key, ...members)
      } catch (error) {
        logger.error('Error removing from set in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    smembers: async (key: string) => {
      try {
        return await upstashClient.smembers(key)
      } catch (error) {
        logger.error('Error getting set members in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    spop: async (key: string, count?: number) => {
      try {
        if (count !== undefined) {
          return await upstashClient.spop<string>(key, count)
        }
        return await upstashClient.spop<string>(key)
      } catch (error) {
        logger.error('Error popping from set in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    scard: async (key: string) => {
      try {
        return await upstashClient.scard(key)
      } catch (error) {
        logger.error('Error getting set cardinality in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    // Sorted set operations
    zadd: async (key: string, ...args: any[]) => {
      try {
        if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'string') {
          // Simple case: zadd(key, score, member)
          return await upstashClient.zadd(key, { score: args[0], member: args[1] })
        } else {
          // Complex case: zadd(key, score1, member1, score2, member2, ...)
          const members: { score: number; member: string }[] = []
          for (let i = 0; i < args.length; i += 2) {
            if (typeof args[i] === 'number' && typeof args[i + 1] === 'string') {
              members.push({ score: args[i], member: args[i + 1] })
            }
          }
          return await upstashClient.zadd(key, ...members)
        }
      } catch (error) {
        logger.error('Error adding to sorted set in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    zrem: async (key: string, ...members: string[]) => {
      try {
        return await upstashClient.zrem(key, ...members)
      } catch (error) {
        logger.error('Error removing from sorted set in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    zrevrange: async (key: string, start: number, stop: number) => {
      try {
        return await upstashClient.zrevrange(key, start, stop)
      } catch (error) {
        logger.error('Error getting reverse range from sorted set in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    zcard: async (key: string) => {
      try {
        return await upstashClient.zcard(key)
      } catch (error) {
        logger.error('Error getting sorted set cardinality in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    zrank: async (key: string, member: string) => {
      try {
        return await upstashClient.zrank(key, member)
      } catch (error) {
        logger.error('Error getting rank in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    zrevrank: async (key: string, member: string) => {
      try {
        return await upstashClient.zrevrank(key, member)
      } catch (error) {
        logger.error('Error getting reverse rank in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    zscore: async (key: string, member: string) => {
      try {
        const score = await upstashClient.zscore(key, member)
        return score !== null ? String(score) : null
      } catch (error) {
        logger.error('Error getting score in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    // TTL operations
    ttl: async (key: string) => {
      try {
        return await upstashClient.ttl(key)
      } catch (error) {
        logger.error('Error getting TTL in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    pttl: async (key: string) => {
      try {
        return await upstashClient.pttl(key)
      } catch (error) {
        logger.error('Error getting PTTL in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    pexpire: async (key: string, milliseconds: number) => {
      try {
        return (await upstashClient.pexpire(key, milliseconds)) as number
      } catch (error) {
        logger.error('Error setting PEXPIRE in Upstash', {
          key,
          error: (error as Error).message,
        })
        throw error
      }
    },

    // Atomic counter operations
    incr: async (key: string) => {
      try {
        return await upstashClient.incr(key)
      } catch (error) {
        logger.error('Error incrementing in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    decr: async (key: string) => {
      try {
        return await upstashClient.decr(key)
      } catch (error) {
        logger.error('Error decrementing in Upstash', { key, error: (error as Error).message })
        throw error
      }
    },

    // Pipeline support (Upstash supports pipelines via REST)
    pipeline: () => upstashClient.pipeline() as any,

    // Pub/Sub operations (not supported by Upstash, will throw errors)
    subscribe: async () => {
      throw new Error(
        'Native subscribe not supported by Upstash Redis. Use polling-based subscription instead.'
      )
    },

    unsubscribe: async () => {
      throw new Error(
        'Native unsubscribe not supported by Upstash Redis. Use polling-based subscription instead.'
      )
    },

    psubscribe: async () => {
      throw new Error(
        'Native psubscribe not supported by Upstash Redis. Use polling-based subscription instead.'
      )
    },

    punsubscribe: async () => {
      throw new Error(
        'Native punsubscribe not supported by Upstash Redis. Use polling-based subscription instead.'
      )
    },

    // Event handling (not supported by REST client)
    on: () => {
      throw new Error(
        'Event handling not supported by Upstash REST client. Use polling-based subscription instead.'
      )
    },

    removeListener: () => {
      throw new Error(
        'Event handling not supported by Upstash REST client. Use polling-based subscription instead.'
      )
    },
  }

  logger.info('Enhanced Upstash Redis client created successfully')
  return enhancedClient
}

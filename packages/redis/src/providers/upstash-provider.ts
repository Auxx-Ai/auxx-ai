// packages/redis/src/providers/upstash-provider.ts
import { Redis } from '@upstash/redis'
import { type RedisClient, logger } from '../types'
import { env } from '@auxx/config/server'

/**
 * Enhanced Upstash provider with additional operations for polling-based pub/sub
 * Upstash doesn't support native pub/sub, so we use lists as message queues
 */
export function createUpstashClient(): RedisClient {
  const restUrl = env.KV_REST_API_URL
  const restToken = env.KV_REST_API_TOKEN

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
      backoff: (retryCount) => Math.min(1000 * Math.pow(2, retryCount), 10000),
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

      // Handle EX case (expiration in seconds)
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        return await upstashClient.set(key, value, { ex: args[1] })
      }

      // Handle additional set commands as needed
      logger.warn(`Upstash set with arguments ${args.join(', ')} may not be fully compatible`)
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

    quit: async () => {
      logger.info('Disconnecting Upstash Redis client')
      // Upstash REST client doesn't need explicit disconnection
      return 'OK'
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

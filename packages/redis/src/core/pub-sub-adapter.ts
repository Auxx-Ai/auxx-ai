// packages/redis/src/core/pub-sub-adapter.ts
import {
  logger,
  type PubSubAdapter,
  type RedisClient,
  type RedisProviderCapabilities,
} from '../types'
import { RedisClientFactory } from './redis-client-factory'

/**
 * Abstract base class for pub/sub adapters
 */
export abstract class BasePubSubAdapter implements PubSubAdapter {
  protected subscriptions = new Map<string, (channel: string, message: string) => void>()
  protected isActive = false

  abstract subscribe(
    pattern: string,
    handler: (channel: string, message: string) => void
  ): Promise<void>
  abstract unsubscribe(pattern: string): Promise<void>
  abstract publish(channel: string, message: string): Promise<number>
  abstract disconnect(): Promise<void>
  abstract getCapabilities(): RedisProviderCapabilities

  isConnected(): boolean {
    return this.isActive
  }

  protected addSubscription(
    pattern: string,
    handler: (channel: string, message: string) => void
  ): void {
    this.subscriptions.set(pattern, handler)
  }

  protected removeSubscription(pattern: string): void {
    this.subscriptions.delete(pattern)
  }

  protected getHandler(pattern: string): ((channel: string, message: string) => void) | undefined {
    return this.subscriptions.get(pattern)
  }
}

/**
 * IORedis adapter for AWS/Hosted Redis providers
 * Uses native Redis pub/sub with pattern-based subscriptions
 */
export class IORedisAdapter extends BasePubSubAdapter {
  private subscriptionClient: RedisClient | null = null
  private publishingClient: RedisClient | null = null

  constructor(private provider: 'aws' | 'hosted') {
    super()
  }

  async subscribe(
    pattern: string,
    handler: (channel: string, message: string) => void
  ): Promise<void> {
    if (!this.subscriptionClient) {
      this.subscriptionClient = await RedisClientFactory.createDedicatedClient(this.provider)
      this.setupSubscriptionHandlers()
    }

    this.addSubscription(pattern, handler)

    if (this.subscriptionClient.psubscribe) {
      await this.subscriptionClient.psubscribe(pattern)
      logger.info(`Subscribed to pattern: ${pattern}`)
    } else {
      throw new Error('psubscribe not supported by Redis client')
    }
  }

  async unsubscribe(pattern: string): Promise<void> {
    if (!this.subscriptionClient) {
      return
    }

    this.removeSubscription(pattern)

    if (this.subscriptionClient.punsubscribe) {
      await this.subscriptionClient.punsubscribe(pattern)
      logger.info(`Unsubscribed from pattern: ${pattern}`)
    }

    // If no more subscriptions, disconnect
    if (this.subscriptions.size === 0) {
      await this.disconnect()
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.publishingClient) {
      this.publishingClient = await RedisClientFactory.createDedicatedClient(this.provider)
    }

    if (this.publishingClient.publish) {
      return await this.publishingClient.publish(channel, message)
    } else {
      throw new Error('publish not supported by Redis client')
    }
  }

  async disconnect(): Promise<void> {
    const promises: Promise<any>[] = []

    if (this.subscriptionClient) {
      promises.push(this.subscriptionClient.quit())
      this.subscriptionClient = null
    }

    if (this.publishingClient) {
      promises.push(this.publishingClient.quit())
      this.publishingClient = null
    }

    await Promise.all(promises)
    this.subscriptions.clear()
    this.isActive = false
    logger.info('IORedis adapter disconnected')
  }

  getCapabilities(): RedisProviderCapabilities {
    return RedisClientFactory.getCapabilities(this.provider)
  }

  private setupSubscriptionHandlers(): void {
    if (!this.subscriptionClient || !this.subscriptionClient.on) {
      return
    }

    this.subscriptionClient.on('pmessage', (pattern: string, channel: string, message: string) => {
      const handler = this.getHandler(pattern)
      if (handler) {
        try {
          handler(channel, message)
        } catch (error) {
          logger.error('Error in subscription handler', {
            pattern,
            channel,
            error: (error as Error).message,
          })
        }
      }
    })

    this.subscriptionClient.on('psubscribe', (pattern: string, count: number) => {
      logger.debug(`Pattern subscription confirmed: ${pattern} (total: ${count})`)
      this.isActive = true
    })

    this.subscriptionClient.on('punsubscribe', (pattern: string, count: number) => {
      logger.debug(`Pattern unsubscription confirmed: ${pattern} (remaining: ${count})`)
      if (count === 0) {
        this.isActive = false
      }
    })

    this.subscriptionClient.on('error', (error: Error) => {
      logger.error('IORedis subscription client error', { error: error.message })
    })
  }
}

/**
 * Upstash polling adapter for Upstash Redis
 * Uses polling-based approach with Redis lists as message queues
 */
export class UpstashPollingAdapter extends BasePubSubAdapter {
  private client: RedisClient | null = null
  private pollingIntervals = new Map<string, NodeJS.Timeout>()
  private pollingInterval = 1000 // 1 second

  constructor(private customPollingInterval?: number) {
    super()
    if (customPollingInterval) {
      this.pollingInterval = customPollingInterval
    }
  }

  async subscribe(
    pattern: string,
    handler: (channel: string, message: string) => void
  ): Promise<void> {
    if (!this.client) {
      this.client = await RedisClientFactory.createDedicatedClient('upstash')
    }

    this.addSubscription(pattern, handler)
    this.startPolling(pattern)
    this.isActive = true
    logger.info(`Started polling for pattern: ${pattern}`)
  }

  async unsubscribe(pattern: string): Promise<void> {
    this.removeSubscription(pattern)
    this.stopPolling(pattern)
    logger.info(`Stopped polling for pattern: ${pattern}`)

    // If no more subscriptions, disconnect
    if (this.subscriptions.size === 0) {
      await this.disconnect()
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.client) {
      this.client = await RedisClientFactory.createDedicatedClient('upstash')
    }

    // For Upstash, we use lists as message queues
    // Convert channel to list key
    const listKey = `events:${channel}`

    if (this.client.lpush) {
      await this.client.lpush(listKey, message)
      logger.debug(`Published message to list: ${listKey}`)
      return 1 // Simulate return value (number of subscribers)
    } else {
      throw new Error('lpush not supported by Redis client')
    }
  }

  async disconnect(): Promise<void> {
    // Stop all polling
    for (const pattern of Array.from(this.subscriptions.keys())) {
      this.stopPolling(pattern)
    }

    if (this.client) {
      await this.client.quit()
      this.client = null
    }

    this.subscriptions.clear()
    this.isActive = false
    logger.info('Upstash polling adapter disconnected')
  }

  getCapabilities(): RedisProviderCapabilities {
    return RedisClientFactory.getCapabilities('upstash')
  }

  private startPolling(pattern: string): void {
    const interval = setInterval(async () => {
      try {
        await this.pollForMessages(pattern)
      } catch (error) {
        logger.error(`Error polling for pattern ${pattern}`, { error: (error as Error).message })
      }
    }, this.pollingInterval)

    this.pollingIntervals.set(pattern, interval)
  }

  private stopPolling(pattern: string): void {
    const interval = this.pollingIntervals.get(pattern)
    if (interval) {
      clearInterval(interval)
      this.pollingIntervals.delete(pattern)
    }
  }

  private async pollForMessages(pattern: string): Promise<void> {
    if (!this.client || !this.client.keys || !this.client.rpop) {
      return
    }

    try {
      // Convert Redis pattern to key pattern for lists
      const keyPattern = `events:${pattern.replace('*', '*')}`
      const keys = await this.client.keys(keyPattern)

      for (const key of keys) {
        // Extract channel from key
        const channel = key.replace('events:', '')

        // Get messages from the list
        let message = await this.client.rpop(key)
        while (message) {
          const handler = this.getHandler(pattern)
          if (handler) {
            try {
              handler(channel, message)
            } catch (error) {
              logger.error('Error in polling handler', {
                pattern,
                channel,
                error: (error as Error).message,
              })
            }
          }
          message = await this.client.rpop(key)
        }
      }
    } catch (error) {
      logger.error('Error in pollForMessages', { pattern, error: (error as Error).message })
    }
  }
}

/**
 * Factory for creating appropriate pub/sub adapters
 */
export class PubSubAdapterFactory {
  static createAdapter(
    provider?: 'upstash' | 'aws' | 'hosted',
    options?: { pollingInterval?: number }
  ): PubSubAdapter {
    const capabilities = RedisClientFactory.getCapabilities(provider)

    if (capabilities.nativePubSub) {
      return new IORedisAdapter(capabilities.provider as 'aws' | 'hosted')
    } else {
      return new UpstashPollingAdapter(options?.pollingInterval)
    }
  }
}

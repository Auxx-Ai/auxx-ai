// packages/redis/src/core/redis-event-router.ts
import {
  type EventHandler,
  type EventRouterStats,
  logger,
  type RedisEvent,
  type SubscriptionOptions,
} from '../types'
import { findMatchingPatterns, matchesPattern } from '../utils/channel-matcher'
import {
  createRedisEvent,
  deserializeRedisEvent,
  generateEventId,
  serializeRedisEvent,
} from '../utils/event-serializer'
import { type BasePubSubAdapter, PubSubAdapterFactory } from './pub-sub-adapter'
import { RedisClientFactory } from './redis-client-factory'

/**
 * General-purpose Redis Event Router
 * Supports multi-instance usage, pattern-based subscriptions, and provider-agnostic event routing
 */
export class RedisEventRouter {
  private static instances = new Map<string, RedisEventRouter>()

  private adapter: BasePubSubAdapter | null = null
  private handlers = new Map<string, EventHandler>()
  private patternHandlers = new Map<string, Set<string>>() // pattern -> handler IDs
  private stats: EventRouterStats
  private startTime = Date.now()

  private constructor(
    private instanceId: string,
    private options: { pollingInterval?: number } = {}
  ) {
    this.stats = {
      activeHandlers: 0,
      totalMessages: 0,
      messageRate: 0,
      lastActivity: null,
      provider: 'unknown',
      connectionStatus: 'disconnected',
      errors: 0,
      uptime: 0,
    }
  }

  /**
   * Get or create a RedisEventRouter instance
   */
  static getInstance(
    instanceId = 'default',
    options: { pollingInterval?: number } = {}
  ): RedisEventRouter {
    if (!RedisEventRouter.instances.has(instanceId)) {
      logger.info(`Creating new RedisEventRouter instance: ${instanceId}`)
      RedisEventRouter.instances.set(instanceId, new RedisEventRouter(instanceId, options))
    }
    return RedisEventRouter.instances.get(instanceId)!
  }

  /**
   * Initialize the router with appropriate adapter
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.adapter) {
      try {
        const providerInfo = RedisClientFactory.getProviderInfo()
        this.adapter = PubSubAdapterFactory.createAdapter(providerInfo.provider, this.options)
        this.stats.provider = providerInfo.provider
        this.stats.connectionStatus = 'connected'
        logger.info(
          `RedisEventRouter ${this.instanceId} initialized with ${providerInfo.provider} adapter`
        )
      } catch (error) {
        this.stats.connectionStatus = 'error'
        this.stats.errors++
        logger.error(`Failed to initialize RedisEventRouter ${this.instanceId}`, {
          error: (error as Error).message,
        })
        throw error
      }
    }
  }

  /**
   * Subscribe to event patterns
   */
  async subscribe(options: SubscriptionOptions): Promise<string> {
    await this.ensureInitialized()

    const handlerId = generateEventId()
    const handler: EventHandler = {
      id: handlerId,
      pattern: options.pattern,
      handler: options.handler,
      metadata: options.metadata,
      once: options.once || false,
      createdAt: new Date(),
      triggerCount: 0,
    }

    // Store handler
    this.handlers.set(handlerId, handler)

    // Track pattern -> handler mapping
    if (!this.patternHandlers.has(options.pattern)) {
      this.patternHandlers.set(options.pattern, new Set())

      // Subscribe to pattern via adapter
      await this.adapter!.subscribe(options.pattern, (channel: string, message: string) => {
        this.handleIncomingMessage(channel, message, options.pattern)
      })
    }

    this.patternHandlers.get(options.pattern)!.add(handlerId)
    this.stats.activeHandlers = this.handlers.size

    logger.info(`Subscribed to pattern: ${options.pattern} (handler: ${handlerId})`)
    return handlerId
  }

  /**
   * Unsubscribe a specific handler
   */
  async unsubscribe(handlerId: string): Promise<void> {
    const handler = this.handlers.get(handlerId)
    if (!handler) {
      logger.warn(`Handler not found for unsubscribe: ${handlerId}`)
      return
    }

    // Remove handler
    this.handlers.delete(handlerId)

    // Remove from pattern mapping
    const patternHandlers = this.patternHandlers.get(handler.pattern)
    if (patternHandlers) {
      patternHandlers.delete(handlerId)

      // If no more handlers for this pattern, unsubscribe from adapter
      if (patternHandlers.size === 0) {
        this.patternHandlers.delete(handler.pattern)
        if (this.adapter) {
          await this.adapter.unsubscribe(handler.pattern)
        }
      }
    }

    this.stats.activeHandlers = this.handlers.size
    logger.info(`Unsubscribed handler: ${handlerId} from pattern: ${handler.pattern}`)
  }

  /**
   * Publish an event to a channel
   */
  async publish(channel: string, data: any): Promise<number> {
    await this.ensureInitialized()

    try {
      const event = createRedisEvent(channel, data)
      const serializedEvent = serializeRedisEvent(event)

      const result = await this.adapter!.publish(channel, serializedEvent)

      logger.debug(`Published event to channel: ${channel}`)
      return result
    } catch (error) {
      this.stats.errors++
      logger.error(`Failed to publish to channel: ${channel}`, { error: (error as Error).message })
      throw error
    }
  }

  /**
   * Handle incoming messages from adapter
   */
  private async handleIncomingMessage(
    channel: string,
    message: string,
    pattern: string
  ): Promise<void> {
    try {
      this.stats.totalMessages++
      this.stats.lastActivity = new Date()

      // Deserialize event
      const event = deserializeRedisEvent(message)
      event.channel = channel // Ensure channel is set correctly

      // Find handlers for this pattern
      const handlerIds = this.patternHandlers.get(pattern)
      if (!handlerIds || handlerIds.size === 0) {
        return
      }

      // Execute handlers
      const promises = Array.from(handlerIds).map(async (handlerId) => {
        const handler = this.handlers.get(handlerId)
        if (!handler) return

        try {
          handler.triggerCount++
          handler.lastTriggered = new Date()

          await handler.handler(event.data)

          // Remove handler if it's a one-time handler
          if (handler.once) {
            await this.unsubscribe(handlerId)
          }
        } catch (error) {
          this.stats.errors++
          logger.error(`Error in event handler ${handlerId}`, {
            pattern,
            channel,
            error: (error as Error).message,
          })
        }
      })

      await Promise.all(promises)
    } catch (error) {
      this.stats.errors++
      logger.error('Error handling incoming message', {
        channel,
        pattern,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Get router statistics
   */
  getStats(): EventRouterStats {
    const now = Date.now()
    const uptime = now - this.startTime

    // Calculate message rate (messages per second over last minute)
    const messageRate = this.stats.totalMessages / Math.max(1, uptime / 1000)

    return {
      ...this.stats,
      uptime: uptime,
      messageRate: parseFloat(messageRate.toFixed(2)),
      connectionStatus: this.adapter?.isConnected() ? 'connected' : 'disconnected',
    }
  }

  /**
   * Disconnect router and cleanup resources
   */
  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect()
      this.adapter = null
    }

    this.handlers.clear()
    this.patternHandlers.clear()
    this.stats.connectionStatus = 'disconnected'
    this.stats.activeHandlers = 0

    logger.info(`RedisEventRouter ${this.instanceId} disconnected`)
  }

  /**
   * Convenience method: Subscribe to workflow events
   */
  async subscribeToWorkflowEvents(
    runId: string,
    handler: (event: any) => void | Promise<void>
  ): Promise<string> {
    return await this.subscribe({
      pattern: `workflow:run:${runId}`,
      handler,
      metadata: { type: 'workflow', runId },
    })
  }

  /**
   * Convenience method: Subscribe to all workflow events
   */
  async subscribeToAllWorkflowEvents(
    handler: (event: any) => void | Promise<void>
  ): Promise<string> {
    return await this.subscribe({
      pattern: 'workflow:run:*',
      handler,
      metadata: { type: 'workflow-all' },
    })
  }

  /**
   * Convenience method: Publish workflow event
   */
  async publishWorkflowEvent(runId: string, data: any): Promise<number> {
    return await this.publish(`workflow:run:${runId}`, data)
  }

  /**
   * Convenience method: Subscribe to document processing events
   */
  async subscribeToDocumentEvents(
    documentId: string,
    handler: (event: any) => void | Promise<void>
  ): Promise<string> {
    return await this.subscribe({
      pattern: `document:process:${documentId}`,
      handler,
      metadata: { type: 'document', documentId },
    })
  }

  /**
   * Convenience method: Subscribe to all document events (for dataset-wide monitoring)
   */
  async subscribeToAllDocumentEvents(
    handler: (event: any) => void | Promise<void>
  ): Promise<string> {
    return await this.subscribe({
      pattern: 'document:process:*',
      handler,
      metadata: { type: 'document-all' },
    })
  }

  /**
   * Convenience method: Publish document event
   */
  async publishDocumentEvent(documentId: string, data: any): Promise<number> {
    return await this.publish(`document:process:${documentId}`, data)
  }

  /**
   * Get all active handlers (for debugging)
   */
  getActiveHandlers(): EventHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * Get handlers by pattern
   */
  getHandlersByPattern(pattern: string): EventHandler[] {
    const handlerIds = this.patternHandlers.get(pattern)
    if (!handlerIds) return []

    return Array.from(handlerIds)
      .map((id) => this.handlers.get(id))
      .filter(Boolean) as EventHandler[]
  }

  /**
   * Close all router instances
   */
  static async closeAllInstances(): Promise<void> {
    const promises = Array.from(RedisEventRouter.instances.values()).map((instance) =>
      instance.disconnect()
    )
    await Promise.all(promises)
    RedisEventRouter.instances.clear()
    logger.info('All RedisEventRouter instances closed')
  }

  /**
   * Close specific router instance
   */
  static async closeInstance(instanceId: string): Promise<void> {
    const instance = RedisEventRouter.instances.get(instanceId)
    if (instance) {
      await instance.disconnect()
      RedisEventRouter.instances.delete(instanceId)
      logger.info(`RedisEventRouter instance ${instanceId} closed`)
    }
  }
}

// packages/lib/src/import/events/event-subscriber.ts

import type Redis from 'ioredis'
import type { AnyImportEvent } from './event-types'

/** Redis channel for import events */
const IMPORT_EVENTS_CHANNEL = 'import:events'

/** Callback for receiving events */
export type EventCallback = (event: AnyImportEvent) => void

/**
 * Subscriber for import events.
 * Uses Redis pub/sub to receive events.
 */
export class ImportEventSubscriber {
  private redis: Redis
  private callbacks: Map<string, Set<EventCallback>> = new Map()
  private isListening = false

  constructor(redis: Redis) {
    this.redis = redis
  }

  /**
   * Subscribe to events for a specific job.
   *
   * @param jobId - Import job ID
   * @param callback - Callback for receiving events
   * @returns Unsubscribe function
   */
  async subscribe(jobId: string, callback: EventCallback): Promise<() => void> {
    const channel = this.getChannel(jobId)

    // Add callback to set
    if (!this.callbacks.has(channel)) {
      this.callbacks.set(channel, new Set())
    }
    this.callbacks.get(channel)!.add(callback)

    // Start listening if not already
    if (!this.isListening) {
      await this.startListening()
    }

    // Subscribe to channel
    await this.redis.subscribe(channel)

    // Return unsubscribe function
    return async () => {
      const callbacks = this.callbacks.get(channel)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.callbacks.delete(channel)
          await this.redis.unsubscribe(channel)
        }
      }
    }
  }

  /**
   * Start listening for messages.
   */
  private async startListening(): Promise<void> {
    if (this.isListening) return
    this.isListening = true

    this.redis.on('message', (channel: string, message: string) => {
      const callbacks = this.callbacks.get(channel)
      if (callbacks) {
        try {
          const event = JSON.parse(message) as AnyImportEvent
          for (const callback of callbacks) {
            callback(event)
          }
        } catch {
          // Ignore parse errors
        }
      }
    })
  }

  /**
   * Get the Redis channel for a specific job.
   *
   * @param jobId - Import job ID
   * @returns Channel name
   */
  private getChannel(jobId: string): string {
    return `${IMPORT_EVENTS_CHANNEL}:${jobId}`
  }

  /**
   * Clean up and disconnect.
   */
  async disconnect(): Promise<void> {
    for (const channel of this.callbacks.keys()) {
      await this.redis.unsubscribe(channel)
    }
    this.callbacks.clear()
    this.isListening = false
  }
}

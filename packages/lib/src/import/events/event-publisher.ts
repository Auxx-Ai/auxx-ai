// packages/lib/src/import/events/event-publisher.ts

import type { RedisClient } from '@auxx/redis'
import type { AnyImportEvent } from './event-types'

/** Redis channel for import events */
const IMPORT_EVENTS_CHANNEL = 'import:events'

/**
 * Publisher for import events.
 * Uses Redis pub/sub to broadcast events to SSE subscribers.
 */
export class ImportEventPublisher {
  private redis: RedisClient

  constructor(redis: RedisClient) {
    this.redis = redis
  }

  /**
   * Publish an import event.
   *
   * @param event - The event to publish
   */
  async publish(event: AnyImportEvent): Promise<void> {
    const channel = this.getChannel(event.jobId)
    await this.redis.publish(channel, JSON.stringify(event))
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
}

/**
 * Create a simple event publisher function.
 *
 * @param redis - Redis client
 * @param jobId - Import job ID
 * @returns Function to publish events
 */
export function createEventPublisher(
  redis: RedisClient,
  jobId: string
): (event: Omit<AnyImportEvent, 'timestamp' | 'jobId'>) => Promise<void> {
  const publisher = new ImportEventPublisher(redis)

  return async (event) => {
    await publisher.publish({
      ...event,
      timestamp: Date.now(),
      jobId,
    } as AnyImportEvent)
  }
}

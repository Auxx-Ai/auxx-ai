// packages/lib/src/timeline/timeline-service.ts

import { type Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  createTimelineEvent,
  getTimelineEvents,
  getRelatedTimelineEvents,
  deleteTimelineEvents,
  type TimelineCursor as ServiceTimelineCursor,
} from '@auxx/services/timeline'
import type {
  TimelineQueryInput,
  TimelineQueryResult,
  CreateTimelineEventInput,
  TimelineEventBase,
  TimelineItem,
  SingleTimelineEvent,
  GroupedTimelineEvent,
  TimelineCursor,
} from './types'
import type { TimelineEventType } from './event-types'
import type { RecordId } from '@auxx/types/resource'

const logger = createScopedLogger('timeline-service')

/** Configuration for event grouping */
const GROUPING_CONFIG = {
  enabled: true,
  windowMs: 2 * 60 * 1000, // 2 minutes
  groupableEvents: [
    // Contact events
    'contact:field:updated',
    'contact:tag:added',
    'contact:tag:removed',
    'contact:group:added',
    // Custom entity events
    'entity:field:updated',
  ] as TimelineEventType[],
}

/** Separator used when encoding timeline cursors */
const TIMELINE_CURSOR_SEPARATOR = '|'

/**
 * Encode a timeline cursor from the provided event metadata
 */
function encodeTimelineCursor(event: { startedAt: Date; id: string }): TimelineCursor {
  return `${event.startedAt.toISOString()}${TIMELINE_CURSOR_SEPARATOR}${event.id}`
}

/**
 * Decode a timeline cursor string into its structured components
 */
function decodeTimelineCursor(cursor: TimelineCursor): { startedAt: Date; id: string } | null {
  const [isoTimestamp, id] = cursor.split(TIMELINE_CURSOR_SEPARATOR)
  if (!isoTimestamp || !id) {
    return null
  }

  const startedAt = new Date(isoTimestamp)
  if (Number.isNaN(startedAt.getTime())) {
    return null
  }

  return { startedAt, id }
}

/** Service for managing timeline events */
export class TimelineService {
  constructor(private db: Database) {}

  /**
   * Create a timeline event
   */
  async createEvent(input: CreateTimelineEventInput): Promise<TimelineEventBase> {
    const result = await createTimelineEvent(input)

    if (result.isErr()) {
      logger.error('Failed to create timeline event', {
        eventType: input.eventType,
        error: result.error,
      })
      throw new Error(`Failed to create timeline event: ${result.error.message}`)
    }

    logger.info('Timeline event created', {
      eventId: result.value.id,
      eventType: input.eventType,
      recordId: input.recordId,
      organizationId: input.organizationId,
    })

    return this.mapEventToBase(result.value)
  }

  /**
   * Get timeline for an entity with pagination and optional grouping
   */
  async getTimeline(input: TimelineQueryInput): Promise<TimelineQueryResult> {
    const {
      organizationId,
      recordId,
      cursor,
      limit = 100,
      isGroupingDisabled = false,
      actorFilter,
      eventTypeFilter,
    } = input

    // Decode cursor if provided
    const decodedCursor = cursor ? decodeTimelineCursor(cursor) : undefined
    const serviceCursor = decodedCursor ?? undefined

    // Call service function
    const result = await getTimelineEvents({
      organizationId,
      recordId,
      cursor: serviceCursor,
      limit,
      actorFilter,
      eventTypeFilter,
    })

    if (result.isErr()) {
      logger.error('Failed to get timeline', {
        recordId,
        error: result.error,
      })
      throw new Error(`Failed to get timeline: ${result.error.message}`)
    }

    const { events, nextCursor } = result.value

    // Map events
    const mappedEvents = events.map((e) => this.mapEventToBase(e))

    // Group events if enabled
    const timelineItems = isGroupingDisabled
      ? mappedEvents.map((e) => this.toSingleEvent(e))
      : this.groupEvents(mappedEvents)

    // Encode next cursor if exists
    const encodedCursor = nextCursor ? encodeTimelineCursor(nextCursor) : undefined

    return {
      events: timelineItems,
      nextCursor: encodedCursor,
      accurateAt: new Date(),
    }
  }

  /**
   * Get timeline for multiple entities (e.g., for a contact showing related tickets)
   */
  async getRelatedTimeline(
    organizationId: string,
    relatedRecordId: RecordId,
    limit = 50
  ): Promise<TimelineEventBase[]> {
    const result = await getRelatedTimelineEvents({
      organizationId,
      relatedRecordId,
      limit,
    })

    if (result.isErr()) {
      logger.error('Failed to get related timeline', {
        relatedRecordId,
        error: result.error,
      })
      throw new Error(`Failed to get related timeline: ${result.error.message}`)
    }

    return result.value.map((e) => this.mapEventToBase(e))
  }

  /**
   * Delete timeline events for an entity (e.g., when entity is deleted)
   */
  async deleteEventsForEntity(
    organizationId: string,
    recordId: RecordId
  ): Promise<void> {
    const result = await deleteTimelineEvents({
      organizationId,
      recordId,
    })

    if (result.isErr()) {
      logger.error('Failed to delete timeline events', {
        recordId,
        error: result.error,
      })
      throw new Error(`Failed to delete timeline events: ${result.error.message}`)
    }

    logger.info('Timeline events deleted', {
      recordId,
      organizationId,
    })
  }

  /**
   * Map database event to TimelineEventBase
   */
  private mapEventToBase(event: any): TimelineEventBase {
    return {
      id: event.id,
      eventType: event.eventType,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      recordId: event.recordId,
      relatedRecordId: event.relatedRecordId,
      entityType: event.entityType,
      entityId: event.entityId,
      relatedEntityType: event.relatedEntityType,
      relatedEntityId: event.relatedEntityId,
      actor: {
        type: event.actorType,
        id: event.actorId,
      },
      eventData: event.eventData || {},
      changes: event.changes,
      metadata: event.metadata,
      isGrouped: event.isGrouped || false,
      groupedEventIds: event.groupedEventIds,
      organizationId: event.organizationId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }
  }

  /**
   * Convert event to single event response
   */
  private toSingleEvent(event: TimelineEventBase): SingleTimelineEvent {
    return {
      type: 'single',
      event,
      eventType: event.eventType,
    }
  }

  /**
   * Group events that occurred within the grouping window
   */
  private groupEvents(events: TimelineEventBase[]): TimelineItem[] {
    if (!GROUPING_CONFIG.enabled) {
      return events.map((e) => this.toSingleEvent(e))
    }

    const result: TimelineItem[] = []
    let currentGroup: TimelineEventBase[] | null = null
    let currentGroupType: TimelineEventType | null = null
    let currentGroupStart: Date | null = null

    for (const event of events) {
      const isGroupable = GROUPING_CONFIG.groupableEvents.includes(event.eventType)

      if (!isGroupable) {
        // Flush current group if exists
        if (currentGroup && currentGroupType && currentGroupStart) {
          result.push(this.createGroupedEvent(currentGroup, currentGroupType, currentGroupStart))
          currentGroup = null
          currentGroupType = null
          currentGroupStart = null
        }
        // Add as single event
        result.push(this.toSingleEvent(event))
        continue
      }

      // Check if this event belongs to current group
      if (
        currentGroup &&
        currentGroupType === event.eventType &&
        currentGroupStart &&
        event.startedAt.getTime() >= currentGroupStart.getTime() - GROUPING_CONFIG.windowMs
      ) {
        // Add to current group
        currentGroup.push(event)
      } else {
        // Flush previous group if exists
        if (currentGroup && currentGroupType && currentGroupStart) {
          result.push(this.createGroupedEvent(currentGroup, currentGroupType, currentGroupStart))
        }
        // Start new group
        currentGroup = [event]
        currentGroupType = event.eventType
        currentGroupStart = event.startedAt
      }
    }

    // Flush final group
    if (currentGroup && currentGroupType && currentGroupStart) {
      if (currentGroup.length > 1) {
        result.push(this.createGroupedEvent(currentGroup, currentGroupType, currentGroupStart))
      } else {
        result.push(this.toSingleEvent(currentGroup[0]!))
      }
    }

    return result
  }

  /**
   * Create a grouped event from multiple events
   */
  private createGroupedEvent(
    events: TimelineEventBase[],
    eventType: TimelineEventType,
    startedAt: Date
  ): GroupedTimelineEvent {
    const endedAt = events[events.length - 1]?.startedAt || startedAt

    return {
      type: 'group',
      startedAt,
      endedAt,
      eventType,
      events: events.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
    }
  }
}

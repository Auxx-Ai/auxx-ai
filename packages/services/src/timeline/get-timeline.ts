// packages/services/src/timeline/get-timeline.ts

import { database, schema } from '@auxx/database'
import { eq, and, desc, inArray, lt, or } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TimelineEventEntity } from '@auxx/database/models'
import { parseResourceId, toResourceId, type ResourceId } from '@auxx/types/resource'

/**
 * Cursor for timeline pagination
 */
export interface TimelineCursor {
  startedAt: Date
  id: string
}

/**
 * Input for getting timeline events
 */
export interface GetTimelineEventsInput {
  organizationId: string
  resourceId: ResourceId
  cursor?: TimelineCursor
  limit?: number
  actorFilter?: string[]
  eventTypeFilter?: string[]
}

/**
 * Timeline event with resourceId attached
 */
export interface TimelineEventWithResourceId extends TimelineEventEntity {
  resourceId: ResourceId
  relatedResourceId?: ResourceId
}

/**
 * Output for getting timeline events
 */
export interface GetTimelineEventsOutput {
  events: TimelineEventWithResourceId[]
  hasMore: boolean
  nextCursor?: TimelineCursor
}

/**
 * Get timeline events for an entity with pagination and filtering
 *
 * @param input - Query parameters
 * @returns Result with timeline events and pagination info
 */
export async function getTimelineEvents(input: GetTimelineEventsInput) {
  const {
    organizationId,
    resourceId,
    cursor,
    limit = 100,
    actorFilter,
    eventTypeFilter,
  } = input

  // Parse resourceId to get components
  const { entityDefinitionId: entityType, entityInstanceId: entityId } = parseResourceId(resourceId)

  // Build where conditions
  const conditions = [
    eq(schema.TimelineEvent.organizationId, organizationId),
    eq(schema.TimelineEvent.entityType, entityType),
    eq(schema.TimelineEvent.entityId, entityId),
  ]

  // Add cursor pagination
  if (cursor) {
    conditions.push(
      or(
        lt(schema.TimelineEvent.startedAt, cursor.startedAt),
        and(
          eq(schema.TimelineEvent.startedAt, cursor.startedAt),
          lt(schema.TimelineEvent.id, cursor.id)
        )
      )!
    )
  }

  // Add filters
  if (actorFilter && actorFilter.length > 0) {
    conditions.push(inArray(schema.TimelineEvent.actorId, actorFilter))
  }

  if (eventTypeFilter && eventTypeFilter.length > 0) {
    conditions.push(inArray(schema.TimelineEvent.eventType, eventTypeFilter))
  }

  // Fetch events with one extra to check for more
  const take = limit + 1
  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.TimelineEvent)
      .where(and(...conditions))
      .orderBy(desc(schema.TimelineEvent.startedAt), desc(schema.TimelineEvent.id))
      .limit(take),
    'get-timeline-events'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const rawEvents = dbResult.value

  // Determine next cursor and trim to requested limit
  let nextCursor: TimelineCursor | undefined
  let hasMore = false

  if (rawEvents.length > limit) {
    hasMore = true
    const cursorEvent = rawEvents[limit]
    if (cursorEvent) {
      nextCursor = {
        startedAt: cursorEvent.startedAt,
        id: cursorEvent.id,
      }
    }
    // Remove the extra event
    rawEvents.pop()
  }

  // Attach resourceId to each event
  const eventsWithResourceId: TimelineEventWithResourceId[] = rawEvents.map((event) => ({
    ...event,
    resourceId: toResourceId(event.entityType, event.entityId),
    ...(event.relatedEntityType && event.relatedEntityId
      ? { relatedResourceId: toResourceId(event.relatedEntityType, event.relatedEntityId) }
      : {}),
  })) as TimelineEventWithResourceId[]

  return ok({
    events: eventsWithResourceId,
    hasMore,
    nextCursor,
  })
}

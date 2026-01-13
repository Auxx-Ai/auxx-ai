// packages/services/src/timeline/get-related-timeline.ts

import { database, schema } from '@auxx/database'
import { eq, and, desc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TimelineEventEntity } from '@auxx/database/models'
import { parseResourceId, toResourceId, type ResourceId } from '@auxx/types/resource'

/**
 * Input for getting related timeline events
 */
export interface GetRelatedTimelineEventsInput {
  organizationId: string
  relatedResourceId: ResourceId
  limit?: number
}

/**
 * Timeline event with resourceId attached
 */
export interface TimelineEventWithResourceId extends TimelineEventEntity {
  resourceId: ResourceId
  relatedResourceId?: ResourceId
}

/**
 * Get timeline events related to a specific entity
 * (e.g., all contact events for a ticket)
 *
 * @param input - Query parameters
 * @returns Result with timeline events
 */
export async function getRelatedTimelineEvents(input: GetRelatedTimelineEventsInput) {
  const { organizationId, relatedResourceId, limit = 50 } = input

  // Parse relatedResourceId to get components
  const {
    entityDefinitionId: relatedEntityType,
    entityInstanceId: relatedEntityId
  } = parseResourceId(relatedResourceId)

  const dbResult = await fromDatabase(
    database
      .select()
      .from(schema.TimelineEvent)
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, organizationId),
          eq(schema.TimelineEvent.relatedEntityType, relatedEntityType),
          eq(schema.TimelineEvent.relatedEntityId, relatedEntityId)
        )
      )
      .orderBy(desc(schema.TimelineEvent.startedAt))
      .limit(limit),
    'get-related-timeline-events'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  // Attach resourceId to each event
  const eventsWithResourceId: TimelineEventWithResourceId[] = dbResult.value.map((event) => ({
    ...event,
    resourceId: toResourceId(event.entityType, event.entityId),
    ...(event.relatedEntityType && event.relatedEntityId
      ? { relatedResourceId: toResourceId(event.relatedEntityType, event.relatedEntityId) }
      : {}),
  })) as TimelineEventWithResourceId[]

  return ok(eventsWithResourceId)
}

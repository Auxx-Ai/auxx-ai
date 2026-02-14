// packages/services/src/timeline/get-related-timeline.ts

import { database, schema } from '@auxx/database'
import type { TimelineEventEntity } from '@auxx/database/models'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, desc, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for getting related timeline events
 */
export interface GetRelatedTimelineEventsInput {
  organizationId: string
  relatedRecordId: RecordId
  limit?: number
}

/**
 * Timeline event with recordId attached
 */
export interface TimelineEventWithRecordId extends TimelineEventEntity {
  recordId: RecordId
  relatedRecordId?: RecordId
}

/**
 * Get timeline events related to a specific entity
 * (e.g., all contact events for a ticket)
 *
 * @param input - Query parameters
 * @returns Result with timeline events
 */
export async function getRelatedTimelineEvents(input: GetRelatedTimelineEventsInput) {
  const { organizationId, relatedRecordId, limit = 50 } = input

  // Parse relatedRecordId to get components
  const { entityDefinitionId: relatedEntityType, entityInstanceId: relatedEntityId } =
    parseRecordId(relatedRecordId)

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

  // Attach recordId to each event
  const eventsWithRecordId: TimelineEventWithRecordId[] = dbResult.value.map((event) => ({
    ...event,
    recordId: toRecordId(event.entityType, event.entityId),
    ...(event.relatedEntityType && event.relatedEntityId
      ? { relatedRecordId: toRecordId(event.relatedEntityType, event.relatedEntityId) }
      : {}),
  })) as TimelineEventWithRecordId[]

  return ok(eventsWithRecordId)
}

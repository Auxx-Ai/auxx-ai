// packages/services/src/timeline/get-related-timeline.ts

import { database, schema } from '@auxx/database'
import { eq, and, desc } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TimelineEventEntity } from '@auxx/database/models'

/**
 * Input for getting related timeline events
 */
export interface GetRelatedTimelineEventsInput {
  organizationId: string
  relatedEntityType: string
  relatedEntityId: string
  limit?: number
}

/**
 * Get timeline events related to a specific entity
 * (e.g., all contact events for a ticket)
 *
 * @param input - Query parameters
 * @returns Result with timeline events
 */
export async function getRelatedTimelineEvents(input: GetRelatedTimelineEventsInput) {
  const { organizationId, relatedEntityType, relatedEntityId, limit = 50 } = input

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

  return ok(dbResult.value as TimelineEventEntity[])
}

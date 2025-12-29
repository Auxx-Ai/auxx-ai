// packages/services/src/timeline/delete-timeline-events.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for deleting timeline events
 */
export interface DeleteTimelineEventsInput {
  organizationId: string
  entityType: string
  entityId: string
}

/**
 * Delete all timeline events for an entity
 * (e.g., when entity is deleted)
 *
 * @param input - Entity identifiers
 * @returns Result indicating success
 */
export async function deleteTimelineEvents(input: DeleteTimelineEventsInput) {
  const { organizationId, entityType, entityId } = input

  const dbResult = await fromDatabase(
    database
      .delete(schema.TimelineEvent)
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, organizationId),
          eq(schema.TimelineEvent.entityType, entityType),
          eq(schema.TimelineEvent.entityId, entityId)
        )
      ),
    'delete-timeline-events'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  return ok({ deleted: true })
}

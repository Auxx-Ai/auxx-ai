// packages/services/src/timeline/delete-timeline-events.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { parseResourceId, type ResourceId } from '@auxx/types/resource'

/**
 * Input for deleting timeline events
 */
export interface DeleteTimelineEventsInput {
  organizationId: string
  resourceId: ResourceId
}

/**
 * Delete all timeline events for an entity
 * (e.g., when entity is deleted)
 *
 * @param input - Entity identifiers
 * @returns Result indicating success
 */
export async function deleteTimelineEvents(input: DeleteTimelineEventsInput) {
  const { organizationId, resourceId } = input

  // Parse resourceId to get components
  const { entityDefinitionId: entityType, entityInstanceId: entityId } = parseResourceId(resourceId)

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

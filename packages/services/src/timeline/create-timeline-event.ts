// packages/services/src/timeline/create-timeline-event.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TimelineEventEntity } from '@auxx/database/models'
import { parseResourceId, toResourceId, type ResourceId } from '@auxx/types/resource'

/**
 * Input for creating a timeline event
 */
export interface CreateTimelineEventInput {
  eventType: string
  resourceId: ResourceId
  relatedResourceId?: ResourceId | null
  actorType: string
  actorId: string
  eventData?: Record<string, any>
  changes?: Array<{
    field: string
    oldValue: any
    newValue: any
  }> | null
  metadata?: Record<string, any> | null
  organizationId: string
  occurredAt?: Date
}

/**
 * Extended timeline event entity with resourceId
 */
export interface TimelineEventWithResourceId extends TimelineEventEntity {
  resourceId: ResourceId
  relatedResourceId?: ResourceId
}

/**
 * Create a timeline event
 *
 * @param input - Event details
 * @returns Result with created timeline event
 */
export async function createTimelineEvent(input: CreateTimelineEventInput) {
  const {
    eventType,
    resourceId,
    relatedResourceId,
    actorType,
    actorId,
    eventData = {},
    changes,
    metadata,
    organizationId,
    occurredAt = new Date(),
  } = input

  // Parse resourceId to get components
  const { entityDefinitionId: entityType, entityInstanceId: entityId } = parseResourceId(resourceId)

  // Parse relatedResourceId if provided
  let relatedEntityType: string | null = null
  let relatedEntityId: string | null = null
  if (relatedResourceId) {
    const parsed = parseResourceId(relatedResourceId)
    relatedEntityType = parsed.entityDefinitionId
    relatedEntityId = parsed.entityInstanceId
  }

  const dbResult = await fromDatabase(
    database
      .insert(schema.TimelineEvent)
      .values({
        eventType,
        startedAt: occurredAt,
        entityType,
        entityId,
        relatedEntityType,
        relatedEntityId,
        actorType,
        actorId,
        eventData,
        changes,
        metadata,
        organizationId,
        updatedAt: new Date(),
      })
      .returning(),
    'create-timeline-event'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const created = dbResult.value[0]
  const event = created as TimelineEventEntity

  // Return event with resourceId attached
  const eventWithResourceId: TimelineEventWithResourceId = {
    ...event,
    resourceId: toResourceId(event.entityType, event.entityId),
    ...(event.relatedEntityType && event.relatedEntityId
      ? { relatedResourceId: toResourceId(event.relatedEntityType, event.relatedEntityId) }
      : {}),
  }

  return ok(eventWithResourceId)
}

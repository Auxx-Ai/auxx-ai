// packages/services/src/timeline/create-timeline-event.ts

import { database, schema } from '@auxx/database'
import type { TimelineEventEntity } from '@auxx/database/models'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Input for creating a timeline event
 */
export interface CreateTimelineEventInput {
  eventType: string
  recordId: RecordId
  relatedRecordId?: RecordId | null
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
 * Extended timeline event entity with recordId
 */
export interface TimelineEventWithRecordId extends TimelineEventEntity {
  recordId: RecordId
  relatedRecordId?: RecordId
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
    recordId,
    relatedRecordId,
    actorType,
    actorId,
    eventData = {},
    changes,
    metadata,
    organizationId,
    occurredAt = new Date(),
  } = input

  // Parse recordId to get components
  const { entityDefinitionId: entityType, entityInstanceId: entityId } = parseRecordId(recordId)

  // Parse relatedRecordId if provided
  let relatedEntityType: string | null = null
  let relatedEntityId: string | null = null
  if (relatedRecordId) {
    const parsed = parseRecordId(relatedRecordId)
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

  // Return event with recordId attached
  const eventWithRecordId: TimelineEventWithRecordId = {
    ...event,
    recordId: toRecordId(event.entityType, event.entityId),
    ...(event.relatedEntityType && event.relatedEntityId
      ? { relatedRecordId: toRecordId(event.relatedEntityType, event.relatedEntityId) }
      : {}),
  }

  return ok(eventWithRecordId)
}

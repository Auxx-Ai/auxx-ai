// packages/services/src/timeline/create-timeline-event.ts

import { database, schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { TimelineEventEntity } from '@auxx/database/models'

/**
 * Input for creating a timeline event
 */
export interface CreateTimelineEventInput {
  eventType: string
  entityType: string
  entityId: string
  relatedEntityType?: string | null
  relatedEntityId?: string | null
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
 * Create a timeline event
 *
 * @param input - Event details
 * @returns Result with created timeline event
 */
export async function createTimelineEvent(input: CreateTimelineEventInput) {
  const {
    eventType,
    entityType,
    entityId,
    relatedEntityType,
    relatedEntityId,
    actorType,
    actorId,
    eventData = {},
    changes,
    metadata,
    organizationId,
    occurredAt = new Date(),
  } = input

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
  return ok(created as TimelineEventEntity)
}

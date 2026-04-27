// packages/lib/src/events/handlers/create-timeline-event.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import {
  ContactEventType,
  EntityInstanceEventType,
  TicketEventType,
  TimelineActorType,
} from '../../timeline/event-types'
import { TimelineService } from '../../timeline/timeline-service'
import type { CreateTimelineEventInput } from '../../timeline/types'
import type {
  AuxxEvent,
  CommentCreatedEvent,
  CommentDeletedEvent,
  CommentRepliedEvent,
  CommentUpdatedEvent,
  ContactCreatedEvent,
  ContactFieldUpdatedEvent,
  ContactGroupAddedEvent,
  ContactGroupRemovedEvent,
  ContactMergedEvent,
  ContactUpdatedEvent,
  EntityInstanceCreatedEvent,
  EntityInstanceDeletedEvent,
  EntityInstanceFieldUpdatedEvent,
  EntityInstanceUpdatedEvent,
  MessageReceivedEvent,
  MessageSentEvent,
  TicketCreatedEvent,
  TicketDeletedEvent,
  TicketFieldUpdatedEvent,
  TicketStatusChangedEvent,
  TicketUpdatedEvent,
} from '../types'

const logger = createScopedLogger('handler:create-timeline-event')

/**
 * Event handler that creates timeline events from published AuxxEvents
 * Returns an array to support dual perspective events (e.g., ticket + contact)
 */
export const createTimelineEvent = async ({ data: event }: { data: AuxxEvent }) => {
  logger.debug('Processing event for timeline', { eventType: event.type })

  try {
    const timelineEvents = mapEventToTimeline(event)

    if (timelineEvents.length === 0) {
      logger.debug('Event not mapped to timeline, skipping', { eventType: event.type })
      return
    }

    const timelineService = new TimelineService(db)

    for (const timelineData of timelineEvents) {
      await timelineService.createEvent(timelineData)
      logger.info('Timeline event created', {
        eventType: event.type,
        timelineEventType: timelineData.eventType,
        recordId: timelineData.recordId,
      })
    }
  } catch (error) {
    logger.error('Failed to create timeline event', {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Maps AuxxEvent to CreateTimelineEventInput[]
 * Returns array to support dual perspective events
 * eventData passes through unchanged - no field transformations
 */
function mapEventToTimeline(event: AuxxEvent): CreateTimelineEventInput[] {
  switch (event.type) {
    // ========================================
    // TICKET EVENTS - Dual perspective (ticket + contact)
    // ========================================
    case 'ticket:created': {
      const data = event.data as TicketCreatedEvent['data']
      const events: CreateTimelineEventInput[] = []

      // 1. Ticket-perspective event (always)
      events.push({
        eventType: TicketEventType.CREATED,
        recordId: data.recordId,
        relatedRecordId: data.relatedRecordId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: data.eventData,
        organizationId: data.organizationId,
      })

      // 2. Contact-perspective event (swapped recordIds)
      if (data.relatedRecordId) {
        events.push({
          eventType: ContactEventType.TICKET_CREATED,
          recordId: data.relatedRecordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: data.eventData,
          organizationId: data.organizationId,
        })
      }

      return events
    }

    case 'ticket:updated': {
      const data = event.data as TicketUpdatedEvent['data']
      const events: CreateTimelineEventInput[] = []

      // 1. Ticket-perspective event
      events.push({
        eventType: TicketEventType.UPDATED,
        recordId: data.recordId,
        relatedRecordId: data.relatedRecordId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: data.eventData,
        organizationId: data.organizationId,
      })

      // 2. Contact-perspective event
      if (data.relatedRecordId) {
        events.push({
          eventType: ContactEventType.TICKET_UPDATED,
          recordId: data.relatedRecordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: data.eventData,
          organizationId: data.organizationId,
        })
      }

      return events
    }

    case 'ticket:deleted': {
      const data = event.data as TicketDeletedEvent['data']
      const events: CreateTimelineEventInput[] = []

      // Check if this is a hard delete or archive
      const isHardDelete = data.eventData?.hardDelete === true
      const eventType = isHardDelete ? TicketEventType.DELETED : TicketEventType.ARCHIVED

      // 1. Ticket-perspective event
      events.push({
        eventType,
        recordId: data.recordId,
        relatedRecordId: data.relatedRecordId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: data.eventData,
        organizationId: data.organizationId,
      })

      return events
    }

    case 'ticket:status:changed': {
      const data = event.data as TicketStatusChangedEvent['data']
      const events: CreateTimelineEventInput[] = []

      // 1. Ticket-perspective event
      events.push({
        eventType: TicketEventType.STATUS_CHANGED,
        recordId: data.recordId,
        relatedRecordId: data.relatedRecordId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: data.eventData,
        organizationId: data.organizationId,
      })

      // 2. Contact-perspective event
      if (data.relatedRecordId) {
        events.push({
          eventType: ContactEventType.TICKET_STATUS_CHANGED,
          recordId: data.relatedRecordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: data.eventData,
          organizationId: data.organizationId,
        })
      }

      return events
    }

    // ========================================
    // MESSAGE/EMAIL EVENTS
    // ========================================
    case 'message:received': {
      const data = event.data as MessageReceivedEvent['data']
      if (!data.recordId) return []

      return [
        {
          eventType: ContactEventType.EMAIL_RECEIVED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('message', data.messageId),
          actorType: TimelineActorType.SYSTEM,
          actorId: 'email-sync',
          eventData: {
            messageId: data.messageId,
            ...(data.threadId && { threadId: data.threadId }),
            ...(data.subject && { subject: data.subject }),
            ...(data.from && { from: data.from }),
            ...(data.snippet && { snippet: data.snippet }),
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'message:sent': {
      const data = event.data as MessageSentEvent['data']
      if (!data.recordId) return []

      return [
        {
          eventType: ContactEventType.EMAIL_SENT,
          recordId: data.recordId,
          relatedRecordId: toRecordId('message', data.messageId),
          actorType: data.userId ? TimelineActorType.USER : TimelineActorType.SYSTEM,
          actorId: data.userId ?? 'system',
          eventData: {
            messageId: data.messageId,
            ...(data.threadId && { threadId: data.threadId }),
            ...(data.subject && { subject: data.subject }),
            ...(data.to && { to: data.to }),
            ...(data.snippet && { snippet: data.snippet }),
          },
          organizationId: data.organizationId,
        },
      ]
    }

    // ========================================
    // CONTACT EVENTS
    // ========================================
    case 'contact:created': {
      const data = event.data as ContactCreatedEvent['data']

      return [
        {
          eventType: ContactEventType.CREATED,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: data.userId ? TimelineActorType.USER : TimelineActorType.SYSTEM,
          actorId: data.userId || 'system',
          eventData: data.eventData,
          organizationId: data.organizationId,
        },
      ]
    }

    case 'contact:updated': {
      const data = event.data as ContactUpdatedEvent['data']

      return [
        {
          eventType: ContactEventType.UPDATED,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: data.eventData,
          organizationId: data.organizationId,
        },
      ]
    }

    case 'contact:merged': {
      const data = event.data as ContactMergedEvent['data']

      return [
        {
          eventType: ContactEventType.MERGED,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            recordId: data.recordId,
            mergedContactIds: data.mergedContactIds,
            totalMerged: data.totalMerged,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'contact:field:updated':
      return mapFieldUpdated(event as ContactFieldUpdatedEvent, ContactEventType.FIELD_UPDATED)

    case 'ticket:field:updated':
      return mapFieldUpdated(event as TicketFieldUpdatedEvent, TicketEventType.FIELD_UPDATED)

    case 'entity:field:updated':
      return mapFieldUpdated(
        event as EntityInstanceFieldUpdatedEvent,
        EntityInstanceEventType.FIELD_UPDATED
      )

    case 'contact:group:added': {
      const data = event.data as ContactGroupAddedEvent['data']

      return [
        {
          eventType: ContactEventType.GROUP_ADDED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('customer_group', data.groupId),
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            recordId: data.recordId,
            groupId: data.groupId,
            groupName: data.groupName,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'contact:group:removed': {
      const data = event.data as ContactGroupRemovedEvent['data']

      return [
        {
          eventType: ContactEventType.GROUP_REMOVED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('customer_group', data.groupId),
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            recordId: data.recordId,
            groupId: data.groupId,
            groupName: data.groupName,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    // ========================================
    // COMMENT EVENTS
    // ========================================
    case 'comment:created': {
      const data = event.data as CommentCreatedEvent['data']

      return [
        {
          eventType: EntityInstanceEventType.NOTE_ADDED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('comment', data.commentId),
          actorType: TimelineActorType.USER,
          actorId: data.createdById,
          eventData: {
            commentId: data.commentId,
            content: data.content,
            ...(data.hasAttachments !== undefined && { hasAttachments: data.hasAttachments }),
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'comment:updated': {
      const data = event.data as CommentUpdatedEvent['data']

      return [
        {
          eventType: EntityInstanceEventType.NOTE_UPDATED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('comment', data.commentId),
          actorType: TimelineActorType.USER,
          actorId: data.createdById,
          eventData: {
            commentId: data.commentId,
            content: data.content,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'comment:deleted': {
      const data = event.data as CommentDeletedEvent['data']

      return [
        {
          eventType: EntityInstanceEventType.NOTE_DELETED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('comment', data.commentId),
          actorType: TimelineActorType.USER,
          actorId: data.createdById,
          eventData: {
            commentId: data.commentId,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'comment:replied': {
      const data = event.data as CommentRepliedEvent['data']

      return [
        {
          eventType: EntityInstanceEventType.NOTE_ADDED,
          recordId: data.recordId,
          relatedRecordId: toRecordId('comment', data.commentId),
          actorType: TimelineActorType.USER,
          actorId: data.createdById,
          eventData: {
            commentId: data.commentId,
            parentCommentId: data.parentCommentId,
            content: data.content,
            isReply: true,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    // ========================================
    // ENTITY INSTANCE EVENTS (Custom Entities)
    // ========================================
    case 'entity:created': {
      const data = event.data as EntityInstanceCreatedEvent['data']

      return [
        {
          eventType: EntityInstanceEventType.CREATED,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            ...data.eventData,
            entityDefinitionId: data.entityDefinitionId,
            entitySlug: data.entitySlug,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'entity:updated': {
      const data = event.data as EntityInstanceUpdatedEvent['data']

      // Use RESTORED if this was a restore operation
      const isRestored = data.eventData?.restored === true
      const eventType = isRestored
        ? EntityInstanceEventType.RESTORED
        : EntityInstanceEventType.UPDATED

      return [
        {
          eventType,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            ...data.eventData,
            entityDefinitionId: data.entityDefinitionId,
            entitySlug: data.entitySlug,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    case 'entity:deleted': {
      const data = event.data as EntityInstanceDeletedEvent['data']

      // Use ARCHIVED for soft delete, DELETED for hard delete
      const isHardDelete = data.eventData?.hardDelete === true
      const eventType = isHardDelete
        ? EntityInstanceEventType.DELETED
        : EntityInstanceEventType.ARCHIVED

      return [
        {
          eventType,
          recordId: data.recordId,
          relatedRecordId: data.recordId,
          actorType: TimelineActorType.USER,
          actorId: data.userId,
          eventData: {
            ...data.eventData,
            entityDefinitionId: data.entityDefinitionId,
            entitySlug: data.entitySlug,
          },
          organizationId: data.organizationId,
        },
      ]
    }

    default:
      return []
  }
}

/** Build a timeline event for any `<prefix>:field:updated` variant. */
function mapFieldUpdated(
  event: ContactFieldUpdatedEvent | TicketFieldUpdatedEvent | EntityInstanceFieldUpdatedEvent,
  eventType:
    | ContactEventType.FIELD_UPDATED
    | TicketEventType.FIELD_UPDATED
    | EntityInstanceEventType.FIELD_UPDATED
): CreateTimelineEventInput[] {
  const data = event.data
  return [
    {
      eventType,
      recordId: data.recordId,
      relatedRecordId: toRecordId('custom_field', data.fieldId),
      actorType: TimelineActorType.USER,
      actorId: data.userId,
      eventData: {
        recordId: data.recordId,
        entityDefinitionId: data.entityDefinitionId,
        entitySlug: data.entitySlug,
        fieldId: data.fieldId,
        fieldName: data.fieldName,
        fieldType: data.fieldType,
        ...(data.bulkOperationId ? { bulkOperationId: data.bulkOperationId } : {}),
      },
      changes: [
        {
          field: data.fieldName,
          fieldType: data.fieldType,
          oldDisplay: data.oldDisplay,
          newDisplay: data.newDisplay,
          oldValue: data.oldValue,
          newValue: data.newValue,
        },
      ],
      organizationId: data.organizationId,
    },
  ]
}

// packages/lib/src/events/handlers/create-timeline-event.ts

import { TimelineService } from '../../timeline/timeline-service'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type {
  AuxxEvent,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketStatusChangedEvent,
  MessageReceivedEvent,
  MessageSentEvent,
  ContactCreatedEvent,
  ContactUpdatedEvent,
  ContactMergedEvent,
  ContactFieldUpdatedEvent,
  ContactGroupAddedEvent,
  ContactGroupRemovedEvent,
  CommentCreatedEvent,
  CommentUpdatedEvent,
  CommentDeletedEvent,
  CommentRepliedEvent,
  EntityInstanceCreatedEvent,
  EntityInstanceUpdatedEvent,
  EntityInstanceDeletedEvent,
} from '../types'
import {
  ContactEventType,
  TimelineEntityType,
  TimelineActorType,
  EntityInstanceEventType,
  createCustomEntityType,
} from '../../timeline/event-types'
import type { CreateTimelineEventInput } from '../../timeline/types'

const logger = createScopedLogger('handler:create-timeline-event')

/**
 * Event handler that creates timeline events from published AuxxEvents
 * Registered in EventHandlers for specific event types
 */
export const createTimelineEvent = async ({ data: event }: { data: AuxxEvent }) => {
  logger.debug('Processing event for timeline', { eventType: event.type })

  try {
    const timelineData = mapEventToTimeline(event)

    if (!timelineData) {
      logger.debug('Event not mapped to timeline, skipping', { eventType: event.type })
      return
    }

    const timelineService = new TimelineService(db)
    await timelineService.createEvent(timelineData)

    logger.info('Timeline event created', {
      eventType: event.type,
      timelineEventType: timelineData.eventType,
      entityId: timelineData.entityId,
    })
  } catch (error) {
    logger.error('Failed to create timeline event', {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Maps AuxxEvent to CreateTimelineEventInput
 * Returns null if event should not create timeline entry
 */
function mapEventToTimeline(event: AuxxEvent): CreateTimelineEventInput | null {
  switch (event.type) {
    // ========================================
    // TICKET EVENTS
    // ========================================
    case 'ticket:created': {
      const data = event.data as TicketCreatedEvent['data']
      // Need contactId in event data to create timeline event
      if (!('contactId' in data)) return null

      return {
        eventType: ContactEventType.TICKET_CREATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId as string,
        relatedEntityType: 'ticket',
        relatedEntityId: data.ticketId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          ticketId: data.ticketId,
          // Include additional data if available
          ...('ticketNumber' in data && { number: data.ticketNumber }),
          ...('ticketTitle' in data && { title: data.ticketTitle }),
          ...('ticketType' in data && { type: data.ticketType }),
        },
        organizationId: data.organizationId,
      }
    }

    case 'ticket:status:changed': {
      const data = event.data as TicketStatusChangedEvent['data']
      if (!('contactId' in data)) return null

      return {
        eventType: ContactEventType.TICKET_STATUS_CHANGED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId as string,
        relatedEntityType: 'ticket',
        relatedEntityId: data.ticketId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          ticketId: data.ticketId,
          newStatus: data.status,
          ...('ticketNumber' in data && { number: data.ticketNumber }),
        },
        changes:
          'oldStatus' in data
            ? [
                {
                  field: 'status',
                  oldValue: data.oldStatus,
                  newValue: data.status,
                },
              ]
            : undefined,
        organizationId: data.organizationId,
      }
    }

    case 'ticket:updated': {
      const data = event.data as TicketUpdatedEvent['data']
      if (!('contactId' in data)) return null

      return {
        eventType: ContactEventType.TICKET_UPDATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId as string,
        relatedEntityType: 'ticket',
        relatedEntityId: data.ticketId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          ticketId: data.ticketId,
          ...('ticketNumber' in data && { number: data.ticketNumber }),
        },
        changes: 'changes' in data ? (data.changes as any) : undefined,
        organizationId: data.organizationId,
      }
    }

    // ========================================
    // MESSAGE/EMAIL EVENTS
    // ========================================
    case 'message:received': {
      const data = event.data as MessageReceivedEvent['data']
      if (!('contactId' in data)) return null

      return {
        eventType: ContactEventType.EMAIL_RECEIVED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId as string,
        relatedEntityType: 'message',
        relatedEntityId: data.messageId,
        actorType: TimelineActorType.SYSTEM,
        actorId: 'email-sync',
        eventData: {
          messageId: data.messageId,
          ...('threadId' in data && { threadId: data.threadId }),
          ...('subject' in data && { subject: data.subject }),
          ...('from' in data && { from: data.from }),
          ...('snippet' in data && { snippet: data.snippet }),
        },
        organizationId: data.organizationId,
      }
    }

    case 'message:sent': {
      const data = event.data as MessageSentEvent['data']
      if (!('contactId' in data)) return null

      return {
        eventType: ContactEventType.EMAIL_SENT,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId as string,
        relatedEntityType: 'message',
        relatedEntityId: data.messageId,
        actorType: 'userId' in data ? TimelineActorType.USER : TimelineActorType.SYSTEM,
        actorId: 'userId' in data ? (data.userId as string) : 'system',
        eventData: {
          messageId: data.messageId,
          ...('threadId' in data && { threadId: data.threadId }),
          ...('subject' in data && { subject: data.subject }),
          ...('to' in data && { to: data.to }),
          ...('snippet' in data && { snippet: data.snippet }),
        },
        organizationId: data.organizationId,
      }
    }

    // ========================================
    // CONTACT EVENTS
    // ========================================
    case 'contact:created': {
      const data = event.data as ContactCreatedEvent['data']

      return {
        eventType: ContactEventType.CREATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'contact',
        relatedEntityId: data.contactId,
        actorType: data.userId ? TimelineActorType.USER : TimelineActorType.SYSTEM,
        actorId: data.userId || 'system',
        eventData: {
          contactId: data.contactId,
          ...('firstName' in data && { firstName: data.firstName }),
          ...('lastName' in data && { lastName: data.lastName }),
          ...('email' in data && { email: data.email }),
          ...('phone' in data && { phone: data.phone }),
          ...('sourceType' in data && { sourceType: data.sourceType }),
        },
        organizationId: data.organizationId,
      }
    }

    case 'contact:updated': {
      const data = event.data as ContactUpdatedEvent['data']

      return {
        eventType: ContactEventType.UPDATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'contact',
        relatedEntityId: data.contactId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          contactId: data.contactId,
          ...('firstName' in data && { firstName: data.firstName }),
          ...('lastName' in data && { lastName: data.lastName }),
          ...('email' in data && { email: data.email }),
        },
        changes: 'changes' in data ? (data.changes as any) : undefined,
        organizationId: data.organizationId,
      }
    }

    case 'contact:merged': {
      const data = event.data as ContactMergedEvent['data']

      return {
        eventType: ContactEventType.MERGED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'contact',
        relatedEntityId: data.contactId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          contactId: data.contactId,
          mergedContactIds: data.mergedContactIds,
          totalMerged: data.totalMerged,
        },
        organizationId: data.organizationId,
      }
    }

    case 'contact:field:updated': {
      const data = event.data as ContactFieldUpdatedEvent['data']

      return {
        eventType: ContactEventType.FIELD_UPDATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'custom_field',
        relatedEntityId: data.fieldId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          contactId: data.contactId,
          fieldId: data.fieldId,
          fieldName: data.fieldName,
          fieldType: data.fieldType,
        },
        changes: [
          {
            field: data.fieldName,
            oldValue: data.oldValue,
            newValue: data.newValue,
          },
        ],
        organizationId: data.organizationId,
      }
    }

    case 'contact:group:added': {
      const data = event.data as ContactGroupAddedEvent['data']

      return {
        eventType: ContactEventType.GROUP_ADDED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'customer_group',
        relatedEntityId: data.groupId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          contactId: data.contactId,
          groupId: data.groupId,
          groupName: data.groupName,
        },
        organizationId: data.organizationId,
      }
    }

    case 'contact:group:removed': {
      const data = event.data as ContactGroupRemovedEvent['data']

      return {
        eventType: ContactEventType.GROUP_REMOVED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.contactId,
        relatedEntityType: 'customer_group',
        relatedEntityId: data.groupId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          contactId: data.contactId,
          groupId: data.groupId,
          groupName: data.groupName,
        },
        organizationId: data.organizationId,
      }
    }

    // ========================================
    // COMMENT EVENTS
    // ========================================
    case 'comment:created': {
      const data = event.data as CommentCreatedEvent['data']

      return {
        eventType: ContactEventType.NOTE_ADDED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.entityId, // entityId IS the contactId
        relatedEntityType: 'comment',
        relatedEntityId: data.commentId,
        actorType: TimelineActorType.USER,
        actorId: data.createdById,
        eventData: {
          commentId: data.commentId,
          content: data.content,
          ...('hasAttachments' in data && { hasAttachments: data.hasAttachments }),
        },
        organizationId: data.organizationId,
      }
    }

    case 'comment:updated': {
      const data = event.data as CommentUpdatedEvent['data']

      return {
        eventType: ContactEventType.NOTE_UPDATED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.entityId, // entityId IS the contactId
        relatedEntityType: 'comment',
        relatedEntityId: data.commentId,
        actorType: TimelineActorType.USER,
        actorId: data.createdById,
        eventData: {
          commentId: data.commentId,
          content: data.content,
        },
        organizationId: data.organizationId,
      }
    }

    case 'comment:deleted': {
      const data = event.data as CommentDeletedEvent['data']

      return {
        eventType: ContactEventType.NOTE_DELETED,
        entityType: TimelineEntityType.CONTACT,
        entityId: data.entityId, // entityId IS the contactId
        relatedEntityType: 'comment',
        relatedEntityId: data.commentId,
        actorType: TimelineActorType.USER,
        actorId: data.createdById,
        eventData: {
          commentId: data.commentId,
        },
        organizationId: data.organizationId,
      }
    }

    case 'comment:replied': {
      const data = event.data as CommentRepliedEvent['data']

      return {
        eventType: ContactEventType.NOTE_ADDED, // Reuse NOTE_ADDED
        entityType: TimelineEntityType.CONTACT,
        entityId: data.entityId, // entityId IS the contactId
        relatedEntityType: 'comment',
        relatedEntityId: data.commentId,
        actorType: TimelineActorType.USER,
        actorId: data.createdById,
        eventData: {
          commentId: data.commentId,
          parentCommentId: data.parentCommentId,
          content: data.content,
          isReply: true,
        },
        organizationId: data.organizationId,
      }
    }

    // ========================================
    // ENTITY INSTANCE EVENTS (Custom Entities)
    // ========================================
    case 'entity:created': {
      const data = event.data as EntityInstanceCreatedEvent['data']

      return {
        eventType: EntityInstanceEventType.CREATED,
        entityType: createCustomEntityType(data.entityDefinitionId),
        entityId: data.instanceId,
        relatedEntityType: 'entity_instance',
        relatedEntityId: data.instanceId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          instanceId: data.instanceId,
          entityDefinitionId: data.entityDefinitionId,
          entitySlug: data.entitySlug,
          displayName: data.displayName,
        },
        organizationId: data.organizationId,
      }
    }

    case 'entity:updated': {
      const data = event.data as EntityInstanceUpdatedEvent['data']

      // Use RESTORED if this was a restore operation
      const eventType = data.restored
        ? EntityInstanceEventType.RESTORED
        : EntityInstanceEventType.UPDATED

      return {
        eventType,
        entityType: createCustomEntityType(data.entityDefinitionId),
        entityId: data.instanceId,
        relatedEntityType: 'entity_instance',
        relatedEntityId: data.instanceId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          instanceId: data.instanceId,
          entityDefinitionId: data.entityDefinitionId,
          entitySlug: data.entitySlug,
          displayName: data.displayName,
          ...(data.restored && { restored: true }),
        },
        organizationId: data.organizationId,
      }
    }

    case 'entity:deleted': {
      const data = event.data as EntityInstanceDeletedEvent['data']

      // Use ARCHIVED for soft delete, DELETED for hard delete
      const eventType = data.hardDelete
        ? EntityInstanceEventType.DELETED
        : EntityInstanceEventType.ARCHIVED

      return {
        eventType,
        entityType: createCustomEntityType(data.entityDefinitionId),
        entityId: data.instanceId,
        relatedEntityType: 'entity_instance',
        relatedEntityId: data.instanceId,
        actorType: TimelineActorType.USER,
        actorId: data.userId,
        eventData: {
          instanceId: data.instanceId,
          entityDefinitionId: data.entityDefinitionId,
          entitySlug: data.entitySlug,
          hardDelete: data.hardDelete,
        },
        organizationId: data.organizationId,
      }
    }

    default:
      return null
  }
}

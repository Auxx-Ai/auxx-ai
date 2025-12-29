// packages/lib/src/timeline/contact-timeline-tracker.ts

import { TimelineService } from './timeline-service'
import { ContactEventType, TimelineEntityType, TimelineActorType } from './event-types'
import type { Database } from '@auxx/database'

/** Helper to track contact timeline events */
export class ContactTimelineTracker {
  private timelineService: TimelineService

  constructor(private db: Database) {
    this.timelineService = new TimelineService(db)
  }

  /** Track contact creation */
  async trackCreated(params: {
    contactId: string
    organizationId: string
    userId: string
    contactData: {
      firstName?: string
      lastName?: string
      email: string
      phone?: string
    }
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.CREATED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: params.contactData,
      organizationId: params.organizationId,
    })
  }

  /** Track contact update */
  async trackUpdated(params: {
    contactId: string
    organizationId: string
    userId: string
    changes: Array<{
      field: string
      oldValue: any
      newValue: any
    }>
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.UPDATED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      changes: params.changes,
      organizationId: params.organizationId,
    })
  }

  /** Track custom field update */
  async trackFieldUpdated(params: {
    contactId: string
    organizationId: string
    userId: string
    fieldId: string
    fieldName: string
    oldValue: any
    newValue: any
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.FIELD_UPDATED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        fieldId: params.fieldId,
        fieldName: params.fieldName,
      },
      changes: [
        {
          field: params.fieldName,
          oldValue: params.oldValue,
          newValue: params.newValue,
        },
      ],
      organizationId: params.organizationId,
    })
  }

  /** Track ticket creation for contact */
  async trackTicketCreated(params: {
    contactId: string
    ticketId: string
    organizationId: string
    userId: string
    ticketData: {
      number: string
      title: string
      type: string
    }
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.TICKET_CREATED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      relatedEntityType: 'ticket',
      relatedEntityId: params.ticketId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: params.ticketData,
      organizationId: params.organizationId,
    })
  }

  /** Track email received from contact */
  async trackEmailReceived(params: {
    contactId: string
    threadId: string
    messageId: string
    organizationId: string
    emailData: {
      subject: string
      from: string
      snippet?: string
    }
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.EMAIL_RECEIVED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      relatedEntityType: 'thread',
      relatedEntityId: params.threadId,
      actorType: TimelineActorType.SYSTEM,
      actorId: 'email-sync',
      eventData: {
        messageId: params.messageId,
        ...params.emailData,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track email sent to contact */
  async trackEmailSent(params: {
    contactId: string
    threadId: string
    messageId: string
    organizationId: string
    userId: string
    emailData: {
      subject: string
      to: string
      snippet?: string
    }
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.EMAIL_SENT,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      relatedEntityType: 'thread',
      relatedEntityId: params.threadId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        messageId: params.messageId,
        ...params.emailData,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track note added to contact */
  async trackNoteAdded(params: {
    contactId: string
    noteId: string
    organizationId: string
    userId: string
    noteData: {
      content: string
    }
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.NOTE_ADDED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        noteId: params.noteId,
        ...params.noteData,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track group membership change */
  async trackGroupAdded(params: {
    contactId: string
    groupId: string
    groupName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.GROUP_ADDED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        groupId: params.groupId,
        groupName: params.groupName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track group removal */
  async trackGroupRemoved(params: {
    contactId: string
    groupId: string
    groupName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.GROUP_REMOVED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        groupId: params.groupId,
        groupName: params.groupName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track tag added to contact */
  async trackTagAdded(params: {
    contactId: string
    tagId: string
    tagName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.TAG_ADDED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        tagId: params.tagId,
        tagName: params.tagName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track tag removed from contact */
  async trackTagRemoved(params: {
    contactId: string
    tagId: string
    tagName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.TAG_REMOVED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        tagId: params.tagId,
        tagName: params.tagName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track contact assignment */
  async trackAssigned(params: {
    contactId: string
    assigneeId: string
    assigneeName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.ASSIGNED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        assigneeId: params.assigneeId,
        assigneeName: params.assigneeName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track contact unassignment */
  async trackUnassigned(params: {
    contactId: string
    previousAssigneeId: string
    previousAssigneeName: string
    organizationId: string
    userId: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.UNASSIGNED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      eventData: {
        previousAssigneeId: params.previousAssigneeId,
        previousAssigneeName: params.previousAssigneeName,
      },
      organizationId: params.organizationId,
    })
  }

  /** Track status change */
  async trackStatusChanged(params: {
    contactId: string
    organizationId: string
    userId: string
    oldStatus: string
    newStatus: string
  }) {
    await this.timelineService.createEvent({
      eventType: ContactEventType.STATUS_CHANGED,
      entityType: TimelineEntityType.CONTACT,
      entityId: params.contactId,
      actorType: TimelineActorType.USER,
      actorId: params.userId,
      changes: [
        {
          field: 'status',
          oldValue: params.oldStatus,
          newValue: params.newStatus,
        },
      ],
      organizationId: params.organizationId,
    })
  }
}

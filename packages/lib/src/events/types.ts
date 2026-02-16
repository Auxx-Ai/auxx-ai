import type { UserEntity as User } from '@auxx/database/models'
import type { InvitationStatus, SYNC_STATUS } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
export type Events =
  | 'user:created'
  | 'workspace:created'
  | 'project:created'
  | 'membership:created'
  | 'webhook:delivery:created'
  | 'ticket:created'
  | 'ticket:updated'
  | 'ticket:deleted'
  | 'ticket:status:changed'
  | 'ticket:assignee:changed'
  | 'ticket:assignee:added'
  | 'ticket:assignee:removed'
  | 'ticket:reply:created'
  | 'message:received'
  | 'message:sent'
  | 'message:failed'
  | 'thread:moved'
  | 'thread:archived'
  | 'thread:deleted'
  | 'thread:reopened'
  | 'thread:deleted'
  | 'thread:restored'
  | 'message:comment:created'
  | 'message:assignee:changed'
  | 'message:tag:added'
  | 'message:tag:removed'
  | 'messages:sync:pending'
  | 'messages:sync:processing'
  | 'messages:sync:complete'
  | 'messages:sync:failed'
  | 'message:processing:started'
  | 'message:processing:completed'
  | 'message:processing:failed'
  | 'message:bulk:processing:started'
  | 'message:bulk:processing:completed'
  | 'message:bulk:processing:failed'
  | 'workflow:paused'
  | 'workflow:resumed'
  | 'workflow:resume:failed'
  | 'approval:created'
  | 'approval:responded'
  | 'approval:cancelled'
  | 'approval:timeout'
  | 'contact:created'
  | 'contact:updated'
  | 'contact:deleted'
  | 'contact:merged'
  | 'contact:field:updated'
  | 'contact:group:added'
  | 'contact:group:removed'
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'comment:replied'
  | 'entity:created'
  | 'entity:updated'
  | 'entity:deleted'
  | 'integration:connected'
  | 'integration:connection_failed'
  | 'shopify:connected'
export type AuxxEventGeneric<U extends Events, T extends Record<string, unknown>> = {
  type: U
  data: T
}
export type TicketCreatedEvent = AuxxEventGeneric<
  'ticket:created',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketUpdatedEvent = AuxxEventGeneric<
  'ticket:updated',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketDeletedEvent = AuxxEventGeneric<
  'ticket:deleted',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketStatusChangedEvent = AuxxEventGeneric<
  'ticket:status:changed',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketAssignedEvent = AuxxEventGeneric<
  'ticket:assignee:added',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketUnassignedEvent = AuxxEventGeneric<
  'ticket:assignee:removed',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type TicketReplyCreatedEvent = AuxxEventGeneric<
  'ticket:reply:created',
  {
    ticketId: string
    organizationId: string
  }
>
export type MessageReceivedEvent = AuxxEventGeneric<
  'message:received',
  {
    messageId: string
    organizationId: string
    // Timeline metadata (optional)
    contactId?: string
    threadId?: string
    subject?: string
    from?: string
    snippet?: string
  }
>
export type MessageSentEvent = AuxxEventGeneric<
  'message:sent',
  {
    messageId: string
    organizationId: string
    // Timeline metadata (optional)
    contactId?: string
    threadId?: string
    userId?: string
    subject?: string
    to?: string
    snippet?: string
  }
>
export type MessageFailedEvent = AuxxEventGeneric<
  'message:failed',
  {
    messageId: string
    organizationId: string
  }
>
export type MessageCommentCreatedEvent = AuxxEventGeneric<
  'message:comment:created',
  {
    messageId: string
    organizationId: string
    commentId: string
    userId: string
  }
>
export type MessageAssigneeChangedEvent = AuxxEventGeneric<
  'message:assignee:changed',
  {
    messageId: string
    organizationId: string
    assigneeIds: string[]
  }
>
export type MessageTagsAddedEvent = AuxxEventGeneric<
  'message:tag:added',
  {
    messageId: string
    organizationId: string
    userId: string
    tagIds: string[]
  }
>
export type MessageTagsRemovedEvent = AuxxEventGeneric<
  'message:tag:removed',
  {
    messageId: string
    organizationId: string
    userId: string
    tagIds: string[]
  }
>
export type ThreadMovedEvent = AuxxEventGeneric<
  'thread:moved',
  {
    threadId: string
    organizationId: string
  }
>
export type ThreadArchivedEvent = AuxxEventGeneric<
  'thread:archived',
  {
    threadId: string
    organizationId: string
  }
>
export type ThreadDeletedEvent = AuxxEventGeneric<
  'thread:deleted',
  {
    threadId: string
    organizationId: string
  }
>
export type ThreadReopenedEvent = AuxxEventGeneric<
  'thread:reopened',
  {
    threadId: string
    organizationId: string
  }
>
export type ThreadRestoredEvent = AuxxEventGeneric<
  'thread:restored',
  {
    threadId: string
    organizationId: string
  }
>
export type ProjectCreatedEvent = AuxxEventGeneric<
  'project:created',
  {
    userEmail: string
    workspaceId: number
    organizationId: string
  }
>
export type UserCreatedEvent = AuxxEventGeneric<
  'user:created',
  User & {
    workspaceId: number
    userEmail: string
    organizationId: string
  }
>
// Define payload for sync events
export type MessageSyncEventData = {
  syncJobId: string // Now refers to the SyncJob ID
  organizationId: string
  userId: string // User who initiated the sync
  errorDetails?: string | null // For failed event
  status: SYNC_STATUS // Include the status this event signals
}
export type MessageSyncPendingEvent = AuxxEventGeneric<
  'messages:sync:pending',
  MessageSyncEventData
>
export type MessageSyncProcessingEvent = AuxxEventGeneric<
  'messages:sync:processing',
  MessageSyncEventData
>
export type MessageSyncCompleteEvent = AuxxEventGeneric<
  'messages:sync:complete',
  MessageSyncEventData
>
export type MessageSyncFailedEvent = AuxxEventGeneric<'messages:sync:failed', MessageSyncEventData>
// Message processing event types
export type MessageProcessingStartedEvent = AuxxEventGeneric<
  'message:processing:started',
  {
    messageId: string
    organizationId: string
    mode?: string
    priority?: number
  }
>
export type MessageProcessingCompletedEvent = AuxxEventGeneric<
  'message:processing:completed',
  {
    messageId: string
    organizationId: string
    processedAt: Date
  }
>
export type MessageProcessingFailedEvent = AuxxEventGeneric<
  'message:processing:failed',
  {
    messageId: string
    organizationId: string
    error: string
    attemptNumber?: number
  }
>
export type MessageBulkProcessingStartedEvent = AuxxEventGeneric<
  'message:bulk:processing:started',
  {
    messageIds: string[]
    organizationId: string
    mode?: string
  }
>
export type MessageBulkProcessingCompletedEvent = AuxxEventGeneric<
  'message:bulk:processing:completed',
  {
    organizationId: string
    totalCount: number
    successCount: number
    failedCount: number
  }
>
export type MessageBulkProcessingFailedEvent = AuxxEventGeneric<
  'message:bulk:processing:failed',
  {
    organizationId: string
    error: string
    partialResults?: {
      successCount: number
      failedCount: number
    }
  }
>
export type WorkflowPausedEvent = AuxxEventGeneric<
  'workflow:paused',
  {
    workflowRunId: string
    organizationId: string
    pausedNodeId: string
    resumeAt: string
  }
>
export type WorkflowResumedEvent = AuxxEventGeneric<
  'workflow:resumed',
  {
    workflowRunId: string
    organizationId: string
    resumedNodeId: string
  }
>
export type WorkflowResumeFailedEvent = AuxxEventGeneric<
  'workflow:resume:failed',
  {
    workflowRunId: string
    error: string
    organizationId: string
    resumeFromNodeId?: string
    failedAt?: string
  }
>
// Approval Events
export type ApprovalCreatedEvent = AuxxEventGeneric<
  'approval:created',
  {
    approvalRequestId: string
    workflowRunId: string
    workflowId: string
    nodeId: string
    organizationId: string
    createdBy: string
  }
>
export type ApprovalRespondedEvent = AuxxEventGeneric<
  'approval:responded',
  {
    approvalRequestId: string
    workflowRunId: string
    action: 'approve' | 'deny'
    userId: string
    organizationId: string
  }
>
export type ApprovalCancelledEvent = AuxxEventGeneric<
  'approval:cancelled',
  {
    approvalRequestId: string
    workflowRunId: string
    cancelledBy: string
    organizationId: string
  }
>
export type ApprovalTimeoutEvent = AuxxEventGeneric<
  'approval:timeout',
  {
    approvalRequestId: string
    workflowRunId: string
    nodeId: string
    organizationId: string
  }
>
// Contact Created Event
export type ContactCreatedEvent = AuxxEventGeneric<
  'contact:created',
  {
    recordId: RecordId
    organizationId: string
    userId?: string
    eventData: Record<string, unknown>
  }
>
// Contact Updated Event
export type ContactUpdatedEvent = AuxxEventGeneric<
  'contact:updated',
  {
    recordId: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
// Contact Deleted Event
export type ContactDeletedEvent = AuxxEventGeneric<
  'contact:deleted',
  {
    recordId: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Contact Merged Event
export type ContactMergedEvent = AuxxEventGeneric<
  'contact:merged',
  {
    contactId: string // Primary contact ID
    organizationId: string
    userId: string
    // Timeline metadata
    mergedContactIds: string[] // IDs of contacts merged into primary
    totalMerged: number
  }
>
// Contact Field Updated Event
export type ContactFieldUpdatedEvent = AuxxEventGeneric<
  'contact:field:updated',
  {
    contactId: string
    organizationId: string
    userId: string
    // Timeline metadata
    fieldId: string
    fieldName: string
    fieldType: string
    oldValue?: any
    newValue: any
  }
>
// Contact Group Added Event
export type ContactGroupAddedEvent = AuxxEventGeneric<
  'contact:group:added',
  {
    contactId: string
    organizationId: string
    userId: string
    // Timeline metadata
    groupId: string
    groupName: string
  }
>
// Contact Group Removed Event
export type ContactGroupRemovedEvent = AuxxEventGeneric<
  'contact:group:removed',
  {
    contactId: string
    organizationId: string
    userId: string
    // Timeline metadata
    groupId: string
    groupName: string
  }
>
// Comment Created Event
export type CommentCreatedEvent = AuxxEventGeneric<
  'comment:created',
  {
    commentId: string
    organizationId: string
    createdById: string // User who created the comment
    // Timeline metadata
    entityId: string // This IS the contactId directly
    content: string // First 150 chars for preview
    hasAttachments?: boolean
  }
>
// Comment Updated Event
export type CommentUpdatedEvent = AuxxEventGeneric<
  'comment:updated',
  {
    commentId: string
    organizationId: string
    createdById: string // User who updated the comment
    // Timeline metadata
    entityId: string // This IS the contactId directly
    content: string // Updated content (first 150 chars)
  }
>
// Comment Deleted Event
export type CommentDeletedEvent = AuxxEventGeneric<
  'comment:deleted',
  {
    commentId: string
    organizationId: string
    createdById: string // User who deleted the comment
    // Timeline metadata
    entityId: string // This IS the contactId directly
  }
>
// Comment Replied Event
export type CommentRepliedEvent = AuxxEventGeneric<
  'comment:replied',
  {
    commentId: string // ID of the reply
    organizationId: string
    createdById: string // User who created the reply
    // Timeline metadata
    entityId: string // This IS the contactId directly
    parentCommentId: string
    content: string // Reply content (first 150 chars)
  }
>

// Entity Instance Created Event
export type EntityInstanceCreatedEvent = AuxxEventGeneric<
  'entity:created',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Entity Instance Updated Event
export type EntityInstanceUpdatedEvent = AuxxEventGeneric<
  'entity:updated',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Entity Instance Deleted Event
export type EntityInstanceDeletedEvent = AuxxEventGeneric<
  'entity:deleted',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

export type MembershipCreatedEvent = AuxxEventGeneric<
  'membership:created',
  {
    userId: string | null
    isNewUser: boolean
    organizationId: string
    email: string
    role: string
    token: string
    expiresAt: Date
    status: InvitationStatus
    invitedById: string
  }
>
export type WebhookDeliveryCreatedEvent = AuxxEventGeneric<
  'webhook:delivery:created',
  {
    webhookId: string
    eventType: Events
    status: 'success' | 'failed'
    responseStatus?: number
    responseBody?: string
    errorMessage?: string
    nextRetryAt?: Date
    organizationId: string
  }
>
// Integration Connected Event
export type IntegrationConnectedEvent = AuxxEventGeneric<
  'integration:connected',
  {
    organizationId: string
    userId: string
    provider: string
    identifier?: string // email, page name, username — whatever the provider returns
    integrationId?: string
  }
>

// Integration Connection Failed Event
export type IntegrationConnectionFailedEvent = AuxxEventGeneric<
  'integration:connection_failed',
  {
    organizationId?: string // May not be available in early failure paths
    userId?: string // May not be available if session check fails
    provider: string // Always known from the route
    error: string
  }
>

// Shopify Connected Event
export type ShopifyConnectedEvent = AuxxEventGeneric<
  'shopify:connected',
  {
    organizationId: string
    userId: string
    shopDomain: string
    integrationId: string
  }
>

export type AuxxEvent =
  | ProjectCreatedEvent
  | UserCreatedEvent
  | MembershipCreatedEvent
  | WebhookDeliveryCreatedEvent
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketDeletedEvent
  | TicketStatusChangedEvent
  | TicketAssignedEvent
  | TicketUnassignedEvent
  | TicketReplyCreatedEvent
  | MessageReceivedEvent
  | MessageSentEvent
  | MessageFailedEvent
  | MessageCommentCreatedEvent
  | MessageAssigneeChangedEvent
  | MessageTagsAddedEvent
  | MessageTagsRemovedEvent
  | ThreadMovedEvent
  | ThreadArchivedEvent
  | ThreadDeletedEvent
  | ThreadReopenedEvent
  | ThreadRestoredEvent
  | MessageSyncPendingEvent
  | MessageSyncProcessingEvent
  | MessageSyncCompleteEvent
  | MessageSyncFailedEvent
  | MessageProcessingStartedEvent
  | MessageProcessingCompletedEvent
  | MessageProcessingFailedEvent
  | MessageBulkProcessingStartedEvent
  | MessageBulkProcessingCompletedEvent
  | MessageBulkProcessingFailedEvent
  | WorkflowPausedEvent
  | WorkflowResumedEvent
  | WorkflowResumeFailedEvent
  | ApprovalCreatedEvent
  | ApprovalRespondedEvent
  | ApprovalCancelledEvent
  | ApprovalTimeoutEvent
  | ContactCreatedEvent
  | ContactUpdatedEvent
  | ContactDeletedEvent
  | ContactMergedEvent
  | ContactFieldUpdatedEvent
  | ContactGroupAddedEvent
  | ContactGroupRemovedEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | CommentRepliedEvent
  | EntityInstanceCreatedEvent
  | EntityInstanceUpdatedEvent
  | EntityInstanceDeletedEvent
  | IntegrationConnectedEvent
  | IntegrationConnectionFailedEvent
  | ShopifyConnectedEvent
export type EventHandler<E extends AuxxEvent> = ({ data }: { data: E }) => void
export interface IEventsHandlers {
  'project:created': EventHandler<ProjectCreatedEvent>[]
  'user:created': EventHandler<UserCreatedEvent>[]
  'membership:created': EventHandler<MembershipCreatedEvent>[]
  'webhook:delivery:created': EventHandler<WebhookDeliveryCreatedEvent>[]
  'ticket:created': EventHandler<TicketCreatedEvent>[]
  'ticket:updated': EventHandler<TicketUpdatedEvent>[]
  'ticket:deleted': EventHandler<TicketDeletedEvent>[]
  'ticket:status:changed': EventHandler<TicketStatusChangedEvent>[]
  'ticket:assignee:added': EventHandler<TicketAssignedEvent>[]
  'ticket:assignee:removed': EventHandler<TicketUnassignedEvent>[]
  'ticket:reply:created': EventHandler<TicketReplyCreatedEvent>[]
  'messages:sync:pending': EventHandler<MessageSyncPendingEvent>[]
  'messages:sync:processing': EventHandler<MessageSyncProcessingEvent>[]
  'messages:sync:complete': EventHandler<MessageSyncCompleteEvent>[]
  'messages:sync:failed': EventHandler<MessageSyncFailedEvent>[]
  'message:received': EventHandler<MessageReceivedEvent>[]
  'message:sent': EventHandler<MessageSentEvent>[]
  'message:failed': EventHandler<MessageFailedEvent>[]
  'message:comment:created': EventHandler<MessageCommentCreatedEvent>[]
  'message:assignee:changed': EventHandler<MessageAssigneeChangedEvent>[]
  'message:tag:added': EventHandler<MessageTagsAddedEvent>[]
  'message:tag:removed': EventHandler<MessageTagsRemovedEvent>[]
  'thread:moved': EventHandler<ThreadMovedEvent>[]
  'thread:archived': EventHandler<ThreadArchivedEvent>[]
  'thread:deleted': EventHandler<ThreadDeletedEvent>[]
  'thread:reopened': EventHandler<ThreadReopenedEvent>[]
  'thread:restored': EventHandler<ThreadRestoredEvent>[]
  'message:processing:started': EventHandler<MessageProcessingStartedEvent>[]
  'message:processing:completed': EventHandler<MessageProcessingCompletedEvent>[]
  'message:processing:failed': EventHandler<MessageProcessingFailedEvent>[]
  'message:bulk:processing:started': EventHandler<MessageBulkProcessingStartedEvent>[]
  'message:bulk:processing:completed': EventHandler<MessageBulkProcessingCompletedEvent>[]
  'message:bulk:processing:failed': EventHandler<MessageBulkProcessingFailedEvent>[]
  'workflow:paused': EventHandler<WorkflowPausedEvent>[]
  'workflow:resumed': EventHandler<WorkflowResumedEvent>[]
  'workflow:resume:failed': EventHandler<WorkflowResumeFailedEvent>[]
  'approval:created': EventHandler<ApprovalCreatedEvent>[]
  'approval:responded': EventHandler<ApprovalRespondedEvent>[]
  'approval:cancelled': EventHandler<ApprovalCancelledEvent>[]
  'approval:timeout': EventHandler<ApprovalTimeoutEvent>[]
  'contact:created': EventHandler<ContactCreatedEvent>[]
  'contact:updated': EventHandler<ContactUpdatedEvent>[]
  'contact:deleted': EventHandler<ContactDeletedEvent>[]
  'contact:merged': EventHandler<ContactMergedEvent>[]
  'contact:field:updated': EventHandler<ContactFieldUpdatedEvent>[]
  'contact:group:added': EventHandler<ContactGroupAddedEvent>[]
  'contact:group:removed': EventHandler<ContactGroupRemovedEvent>[]
  'comment:created': EventHandler<CommentCreatedEvent>[]
  'comment:updated': EventHandler<CommentUpdatedEvent>[]
  'comment:deleted': EventHandler<CommentDeletedEvent>[]
  'comment:replied': EventHandler<CommentRepliedEvent>[]
  'entity:created': EventHandler<EntityInstanceCreatedEvent>[]
  'entity:updated': EventHandler<EntityInstanceUpdatedEvent>[]
  'entity:deleted': EventHandler<EntityInstanceDeletedEvent>[]
  'integration:connected': EventHandler<IntegrationConnectedEvent>[]
  'integration:connection_failed': EventHandler<IntegrationConnectionFailedEvent>[]
  'shopify:connected': EventHandler<ShopifyConnectedEvent>[]
}

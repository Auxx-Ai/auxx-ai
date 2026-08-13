import type { InvitationStatus, SYNC_STATUS, UserEntity as User } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { SignalKind } from '../signals/types'
import type { TimelineFieldChangeSnapshotValue } from '../timeline/field-change-snapshot'
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
  | 'thread:taken_over'
  | 'thread:returned_to_ai'
  | 'thread:assignee:changed'
  | 'thread:visitor:identified'
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
  | 'comment:referenced'
  | 'entity:created'
  | 'entity:updated'
  | 'entity:deleted'
  | 'entity:field:updated'
  | 'signal:recorded'
  | 'ticket:field:updated'
  | 'stock_movement:created'
  | 'stock_movement:deleted'
  | 'vendor_part:created'
  | 'vendor_part:deleted'
  | 'subpart:created'
  | 'subpart:deleted'
  | 'company:created'
  | 'company:deleted'
  | 'field:trigger'
  | 'sync:records:changed'
  | 'integration:connected'
  | 'integration:connection_failed'
  | 'shopify:connected'
  | 'recording:ai.summary_ready'
  | 'recording:ai.chapters_ready'
  | 'recording:ai.insights_ready'
  | 'recording:ai.failed'
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
/**
 * A reply was recorded on a ticket. Registered as a direct-match agent trigger
 * (`ALLOWED_DIRECT_EVENT_TYPES`) and a webhook event (`WEBHOOK_EVENTS`); it has
 * no emitter yet, so the handler chain below is currently dormant.
 */
export type TicketReplyCreatedEvent = AuxxEventGeneric<
  'ticket:reply:created',
  {
    recordId: RecordId
    relatedRecordId?: RecordId
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type MessageReceivedEvent = AuxxEventGeneric<
  'message:received',
  {
    messageId: string
    organizationId: string
    // Timeline metadata (optional). When present, the contact's canonical
    // recordId — drives timeline routing.
    recordId?: RecordId
    threadId?: string
    /** The channel (`Integration.id`) this message arrived on. Hydrated at the
     * publish site (`store-message.ts`) — already in hand there, zero extra
     * query — so the dispatcher (`trigger-message-workflows.ts`) can gate a
     * workflow's channel scope without loading the message. */
    integrationId?: string
    /** The thread's inbox at publish time. Same zero-extra-query rationale as
     * `integrationId`. */
    inboxId?: string
    subject?: string
    from?: string
    snippet?: string
    /** Set when ingest-time header analysis flagged this as machine-generated mail.
     * `hard` = loop-forming (bounces/NDRs/daemon senders) — automated consumers must
     * never answer; `soft` = automated but possibly wanted (OOO, list/notification
     * mail) — excluded from workflows by default, per-trigger opt-in. The same object
     * is persisted at `Message.metadata.machineMail`. */
    machineMail?: { tier: 'hard' | 'soft'; reason: string }
    /** Set when this inbound row is PROVEN to be a copy of a message we sent —
     * its `X-AuxxAi-Message-Id` header resolved to a `Message` row in this org
     * carrying a `sendToken`. The hard tier of the loop guard: the workflow
     * dispatcher and mail classification both skip it unconditionally, because
     * a literal duplicate of our own outbound mail is not a new event. Carries
     * the id of the row we sent, for log correlation. */
    ownEcho?: { sentMessageId: string }
    /** Set when the sender address is one of the org's connected channel
     * addresses (`buildOrgOwnEmailAddressSet` — every non-deleted channel's
     * email plus provider aliases, personal mailboxes included). Descriptive,
     * NOT a verdict: a teammate mailing the shared inbox from their connected
     * mailbox looks identical to a cross-channel echo at the address level, so
     * the trigger decides via `MessageReceivedNodeData.ownAddress` (default
     * `'include'` — it fires). The proven case is `ownEcho` above. */
    fromOwnAddress?: true
  }
>
export type MessageSentEvent = AuxxEventGeneric<
  'message:sent',
  {
    messageId: string
    organizationId: string
    // Timeline metadata (optional). When present, the contact's canonical
    // recordId — drives timeline routing.
    recordId?: RecordId
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
    /** The user who archived the thread. */
    userId: string
    /**
     * Chat visitor Participant id from `Thread.metadata` (`null` for email
     * threads). Emitters that have the thread row in hand set this so the
     * realtime handler can skip a Thread SELECT.
     */
    visitorParticipantId?: string | null
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
    /** The user who reopened the thread. */
    userId: string
    /** See ThreadArchivedEvent.visitorParticipantId. */
    visitorParticipantId?: string | null
  }
>
export type ThreadRestoredEvent = AuxxEventGeneric<
  'thread:restored',
  {
    threadId: string
    organizationId: string
  }
>
export type ThreadTakenOverEvent = AuxxEventGeneric<
  'thread:taken_over',
  {
    threadId: string
    organizationId: string
    /** The user who took the thread over (new assignee / driver). */
    userId: string
    /** Handoff state prior to the take-over (always `'ai'` today, but typed for future flows). */
    previousState: 'ai' | 'human'
    /** See ThreadArchivedEvent.visitorParticipantId. */
    visitorParticipantId?: string | null
  }
>
export type ThreadReturnedToAiEvent = AuxxEventGeneric<
  'thread:returned_to_ai',
  {
    threadId: string
    organizationId: string
    /** The user who handed the thread back to the AI agent. */
    userId: string
    /** See ThreadArchivedEvent.visitorParticipantId. */
    visitorParticipantId?: string | null
  }
>
export type ThreadAssigneeChangedEvent = AuxxEventGeneric<
  'thread:assignee:changed',
  {
    threadId: string
    organizationId: string
    fromUserId: string | null
    toUserId: string | null
    /** See ThreadArchivedEvent.visitorParticipantId. */
    visitorParticipantId?: string | null
  }
>
export type ThreadVisitorIdentifiedEvent = AuxxEventGeneric<
  'thread:visitor:identified',
  {
    threadId: string
    organizationId: string
    visitorEmail: string
    /** Visitor Participant id (the chat visitor's stable Participant row). */
    participantId: string
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
    /** `null` for an `access`-kind approval — it has no workflow run (plan 28 §3). */
    workflowRunId: string | null
    action: 'approve' | 'deny'
    userId: string
    organizationId: string
  }
>
export type ApprovalCancelledEvent = AuxxEventGeneric<
  'approval:cancelled',
  {
    approvalRequestId: string
    /** `null` for an `access`-kind approval — it has no workflow run (plan 28 §3). */
    workflowRunId: string | null
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
    recordId: RecordId // Primary contact's canonical recordId
    organizationId: string
    userId: string
    // Timeline metadata
    mergedContactIds: string[] // IDs of contacts merged into primary
    totalMerged: number
  }
>
/**
 * Shared payload for `<prefix>:field:updated` events. Identical shape across
 * contact, ticket, and custom-entity variants — only the event `type` differs.
 * Consumers that need entity-specific rendering switch on the event type.
 */
export type FieldUpdatedData = {
  recordId: RecordId
  entityDefinitionId: string
  entitySlug: string
  organizationId: string
  userId: string
  fieldId: string
  fieldName: string
  fieldType: string
  /** Raw — kept for compat / analytics. May be removed in a follow-up. */
  oldValue?: any
  newValue: any
  /** Server-resolved snapshot. Render from these, not from oldValue/newValue. */
  oldDisplay?: TimelineFieldChangeSnapshotValue
  newDisplay?: TimelineFieldChangeSnapshotValue
  /**
   * When set, this event is one of many emitted by a single bulk operation.
   * Persisted into timeline `eventData` for later cross-record grouping.
   */
  bulkOperationId?: string
}

// Contact Field Updated Event
export type ContactFieldUpdatedEvent = AuxxEventGeneric<'contact:field:updated', FieldUpdatedData>

// Ticket Field Updated Event
export type TicketFieldUpdatedEvent = AuxxEventGeneric<'ticket:field:updated', FieldUpdatedData>

// Entity Instance Field Updated Event (custom entities + any built-in type without a dedicated prefix)
export type EntityInstanceFieldUpdatedEvent = AuxxEventGeneric<
  'entity:field:updated',
  FieldUpdatedData
>

// Signal Recorded Event — fires after `recordSignal()`/`recordSignals()` writes land and the
// rollup update runs (plans/signals/01-signal-store.md "Write path"). Everything downstream
// (timeline projection, record rules, Today nudges, realtime) hangs off this event. The
// dedupe no-op write path publishes nothing.
export type SignalRecordedEvent = AuxxEventGeneric<
  'signal:recorded',
  {
    signalId: string
    organizationId: string
    kind: SignalKind
    subtype: string
    occurredAt: Date
    contactEntityInstanceId: string | null
    recordKeys: string[]
    isBot: boolean
    /** True for identity-backfill writes — consumers that drive automation must skip these. */
    backfill?: boolean
    /** Set for bulk writes (`recordSignals()`): all signal ids in the batch for this contact. */
    signalIds?: string[]
  }
>

// Contact Group Added Event
export type ContactGroupAddedEvent = AuxxEventGeneric<
  'contact:group:added',
  {
    recordId: RecordId
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
    recordId: RecordId
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
    // Canonical recordId of the entity the comment is attached to
    // (thread / ticket / contact / custom entity).
    recordId: RecordId
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
    recordId: RecordId
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
    recordId: RecordId
  }
>
// Comment Replied Event
export type CommentRepliedEvent = AuxxEventGeneric<
  'comment:replied',
  {
    commentId: string // ID of the reply
    organizationId: string
    createdById: string // User who created the reply
    recordId: RecordId
    parentCommentId: string
    content: string // Reply content (first 150 chars)
  }
>

/**
 * Fires once per `CommentReference` row when a comment is created.
 * The dispatcher uses this to enqueue agent mention triggers.
 */
export type CommentReferencedEvent = AuxxEventGeneric<
  'comment:referenced',
  {
    commentId: string
    organizationId: string
    mentionerUserId: string
    /** The entity the comment is attached to. */
    parentRecordId: RecordId
    /** The reference this event is for. */
    referencedRecordId: RecordId
    /** All other RecordIds referenced in the same comment. */
    siblingReferences: RecordId[]
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

// Stock Movement Events
export type StockMovementCreatedEvent = AuxxEventGeneric<
  'stock_movement:created',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type StockMovementDeletedEvent = AuxxEventGeneric<
  'stock_movement:deleted',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Vendor Part Events
export type VendorPartCreatedEvent = AuxxEventGeneric<
  'vendor_part:created',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type VendorPartDeletedEvent = AuxxEventGeneric<
  'vendor_part:deleted',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Subpart Events
export type SubpartCreatedEvent = AuxxEventGeneric<
  'subpart:created',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type SubpartDeletedEvent = AuxxEventGeneric<
  'subpart:deleted',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Company Events
export type CompanyCreatedEvent = AuxxEventGeneric<
  'company:created',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>
export type CompanyDeletedEvent = AuxxEventGeneric<
  'company:deleted',
  {
    recordId: RecordId
    entityDefinitionId: string
    entitySlug: string
    organizationId: string
    userId: string
    eventData: Record<string, unknown>
  }
>

// Field Trigger Event — fired when a field with a registered trigger changes
export type FieldTriggerJobEvent = AuxxEventGeneric<
  'field:trigger',
  {
    systemAttribute: SystemAttribute
    recordIds: RecordId[]
    organizationId: string
    userId: string
  }
>

/**
 * B2 — pointer event for a bulk writer's sync-change manifest. Carries pointers only:
 * the manifest lives on the DataConnectorRun row (connector runs) or the ImportJob row
 * (imports). The record-rules sync consumer refetches, claims once-only consumption,
 * and fires the engine with `source: 'sync'`. See plans/events/b2-sync-change-manifest-plan.md.
 */
export type SyncRecordsChangedEvent = AuxxEventGeneric<
  'sync:records:changed',
  {
    source: 'connector' | 'import'
    organizationId: string
    runId?: string
    dataConnectorId?: string
    importRef?: string
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

// Recording AI post-processing events
export type RecordingAiSummaryReadyEvent = AuxxEventGeneric<
  'recording:ai.summary_ready',
  {
    recordingId: string
    organizationId: string
  }
>

export type RecordingAiChaptersReadyEvent = AuxxEventGeneric<
  'recording:ai.chapters_ready',
  {
    recordingId: string
    organizationId: string
    chapterCount: number
  }
>

export type RecordingAiInsightsReadyEvent = AuxxEventGeneric<
  'recording:ai.insights_ready',
  {
    recordingId: string
    organizationId: string
    insightId: string
    templateId: string
  }
>

export type RecordingAiFailedEvent = AuxxEventGeneric<
  'recording:ai.failed',
  {
    recordingId: string
    organizationId: string
    scope: 'summary' | 'chapters' | 'insights' | 'all'
    error: string
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
  | ThreadTakenOverEvent
  | ThreadReturnedToAiEvent
  | ThreadAssigneeChangedEvent
  | ThreadVisitorIdentifiedEvent
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
  | TicketFieldUpdatedEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | CommentRepliedEvent
  | CommentReferencedEvent
  | EntityInstanceCreatedEvent
  | EntityInstanceUpdatedEvent
  | EntityInstanceDeletedEvent
  | EntityInstanceFieldUpdatedEvent
  | SignalRecordedEvent
  | StockMovementCreatedEvent
  | StockMovementDeletedEvent
  | VendorPartCreatedEvent
  | VendorPartDeletedEvent
  | SubpartCreatedEvent
  | SubpartDeletedEvent
  | CompanyCreatedEvent
  | CompanyDeletedEvent
  | FieldTriggerJobEvent
  | SyncRecordsChangedEvent
  | IntegrationConnectedEvent
  | IntegrationConnectionFailedEvent
  | ShopifyConnectedEvent
  | RecordingAiSummaryReadyEvent
  | RecordingAiChaptersReadyEvent
  | RecordingAiInsightsReadyEvent
  | RecordingAiFailedEvent
export type EventHandler<E extends AuxxEvent> = ({ data }: { data: E }) => void

/**
 * What a gate handler asks the fan-out to skip (mail-filters plan §3).
 *
 * The strings are `Function.prototype.name`s of handlers in the SAME entry's
 * `then` list — the only coupling between this map and the worker's
 * `eventHandlersJobMappings`, which keys its job names the same way. Never
 * hand-write a literal here: read `.name` off the imported handler function so
 * a rename can't silently stop suppressing.
 */
export interface GateResult {
  suppress: string[]
}

/**
 * A handler that runs INLINE, before the fan-out, and may veto part of it.
 *
 * Unlike {@link EventHandler} (enqueued onto `eventHandlersQueue` and awaited by
 * nobody) a gate handler is awaited by `publishEventJob` itself, so it holds an
 * `eventsQueue` slot for its whole duration. It must therefore be fast and it
 * must never throw for a reason the caller can't recover from — the gate phase
 * fails OPEN (invariant 3): a throw or a timeout suppresses nothing.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is a gate with nothing to suppress — the shape every EventHandler already returns.
export type GateHandler<E extends AuxxEvent> = ({ data }: { data: E }) => Promise<GateResult | void>

/** An event type whose fan-out is preceded by one or more inline gates. */
export interface GatedEventHandlers<E extends AuxxEvent> {
  gate: GateHandler<E>[]
  then: EventHandler<E>[]
}

/**
 * One entry in {@link IEventsHandlers}: either the plain fan-out list every
 * event type has always used, or a gated pair. A plain array behaves exactly as
 * before — there is no migration of the ~75 ungated types.
 */
export type EventHandlerEntry<E extends AuxxEvent> = EventHandler<E>[] | GatedEventHandlers<E>

export interface IEventsHandlers {
  'project:created': EventHandlerEntry<ProjectCreatedEvent>
  'user:created': EventHandlerEntry<UserCreatedEvent>
  'membership:created': EventHandlerEntry<MembershipCreatedEvent>
  'webhook:delivery:created': EventHandlerEntry<WebhookDeliveryCreatedEvent>
  'ticket:created': EventHandlerEntry<TicketCreatedEvent>
  'ticket:updated': EventHandlerEntry<TicketUpdatedEvent>
  'ticket:deleted': EventHandlerEntry<TicketDeletedEvent>
  'ticket:status:changed': EventHandlerEntry<TicketStatusChangedEvent>
  'ticket:assignee:added': EventHandlerEntry<TicketAssignedEvent>
  'ticket:assignee:removed': EventHandlerEntry<TicketUnassignedEvent>
  'ticket:reply:created': EventHandlerEntry<TicketReplyCreatedEvent>
  'messages:sync:pending': EventHandlerEntry<MessageSyncPendingEvent>
  'messages:sync:processing': EventHandlerEntry<MessageSyncProcessingEvent>
  'messages:sync:complete': EventHandlerEntry<MessageSyncCompleteEvent>
  'messages:sync:failed': EventHandlerEntry<MessageSyncFailedEvent>
  'message:received': EventHandlerEntry<MessageReceivedEvent>
  'message:sent': EventHandlerEntry<MessageSentEvent>
  'message:failed': EventHandlerEntry<MessageFailedEvent>
  'message:comment:created': EventHandlerEntry<MessageCommentCreatedEvent>
  'message:assignee:changed': EventHandlerEntry<MessageAssigneeChangedEvent>
  'message:tag:added': EventHandlerEntry<MessageTagsAddedEvent>
  'message:tag:removed': EventHandlerEntry<MessageTagsRemovedEvent>
  'thread:moved': EventHandlerEntry<ThreadMovedEvent>
  'thread:archived': EventHandlerEntry<ThreadArchivedEvent>
  'thread:deleted': EventHandlerEntry<ThreadDeletedEvent>
  'thread:reopened': EventHandlerEntry<ThreadReopenedEvent>
  'thread:restored': EventHandlerEntry<ThreadRestoredEvent>
  'thread:taken_over': EventHandlerEntry<ThreadTakenOverEvent>
  'thread:returned_to_ai': EventHandlerEntry<ThreadReturnedToAiEvent>
  'thread:assignee:changed': EventHandlerEntry<ThreadAssigneeChangedEvent>
  'thread:visitor:identified': EventHandlerEntry<ThreadVisitorIdentifiedEvent>
  'message:processing:started': EventHandlerEntry<MessageProcessingStartedEvent>
  'message:processing:completed': EventHandlerEntry<MessageProcessingCompletedEvent>
  'message:processing:failed': EventHandlerEntry<MessageProcessingFailedEvent>
  'message:bulk:processing:started': EventHandlerEntry<MessageBulkProcessingStartedEvent>
  'message:bulk:processing:completed': EventHandlerEntry<MessageBulkProcessingCompletedEvent>
  'message:bulk:processing:failed': EventHandlerEntry<MessageBulkProcessingFailedEvent>
  'workflow:paused': EventHandlerEntry<WorkflowPausedEvent>
  'workflow:resumed': EventHandlerEntry<WorkflowResumedEvent>
  'workflow:resume:failed': EventHandlerEntry<WorkflowResumeFailedEvent>
  'approval:created': EventHandlerEntry<ApprovalCreatedEvent>
  'approval:responded': EventHandlerEntry<ApprovalRespondedEvent>
  'approval:cancelled': EventHandlerEntry<ApprovalCancelledEvent>
  'approval:timeout': EventHandlerEntry<ApprovalTimeoutEvent>
  'contact:created': EventHandlerEntry<ContactCreatedEvent>
  'contact:updated': EventHandlerEntry<ContactUpdatedEvent>
  'contact:deleted': EventHandlerEntry<ContactDeletedEvent>
  'contact:merged': EventHandlerEntry<ContactMergedEvent>
  'contact:field:updated': EventHandlerEntry<ContactFieldUpdatedEvent>
  'contact:group:added': EventHandlerEntry<ContactGroupAddedEvent>
  'contact:group:removed': EventHandlerEntry<ContactGroupRemovedEvent>
  'ticket:field:updated': EventHandlerEntry<TicketFieldUpdatedEvent>
  'comment:created': EventHandlerEntry<CommentCreatedEvent>
  'comment:updated': EventHandlerEntry<CommentUpdatedEvent>
  'comment:deleted': EventHandlerEntry<CommentDeletedEvent>
  'comment:replied': EventHandlerEntry<CommentRepliedEvent>
  'comment:referenced': EventHandlerEntry<CommentReferencedEvent>
  'entity:created': EventHandlerEntry<EntityInstanceCreatedEvent>
  'entity:updated': EventHandlerEntry<EntityInstanceUpdatedEvent>
  'entity:deleted': EventHandlerEntry<EntityInstanceDeletedEvent>
  'entity:field:updated': EventHandlerEntry<EntityInstanceFieldUpdatedEvent>
  'signal:recorded': EventHandlerEntry<SignalRecordedEvent>
  'stock_movement:created': EventHandlerEntry<StockMovementCreatedEvent>
  'stock_movement:deleted': EventHandlerEntry<StockMovementDeletedEvent>
  'vendor_part:created': EventHandlerEntry<VendorPartCreatedEvent>
  'vendor_part:deleted': EventHandlerEntry<VendorPartDeletedEvent>
  'subpart:created': EventHandlerEntry<SubpartCreatedEvent>
  'subpart:deleted': EventHandlerEntry<SubpartDeletedEvent>
  'company:created': EventHandlerEntry<CompanyCreatedEvent>
  'company:deleted': EventHandlerEntry<CompanyDeletedEvent>
  'field:trigger': EventHandlerEntry<FieldTriggerJobEvent>
  'sync:records:changed': EventHandlerEntry<SyncRecordsChangedEvent>
  'integration:connected': EventHandlerEntry<IntegrationConnectedEvent>
  'integration:connection_failed': EventHandlerEntry<IntegrationConnectionFailedEvent>
  'shopify:connected': EventHandlerEntry<ShopifyConnectedEvent>
  'recording:ai.summary_ready': EventHandlerEntry<RecordingAiSummaryReadyEvent>
  'recording:ai.chapters_ready': EventHandlerEntry<RecordingAiChaptersReadyEvent>
  'recording:ai.insights_ready': EventHandlerEntry<RecordingAiInsightsReadyEvent>
  'recording:ai.failed': EventHandlerEntry<RecordingAiFailedEvent>
}

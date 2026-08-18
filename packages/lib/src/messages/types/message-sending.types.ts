// packages/lib/src/messages/types/message-sending.types.ts
// `@auxx/database/enums` exports these as const *objects* (values); the matching
// string-literal union *types* live in `@auxx/database/types`.
import type { IdentifierType, ParticipantRole, SendStatus } from '@auxx/database/types'

/**
 * Input for sending a message
 */
export interface SendMessageInput {
  // User & Organization
  userId: string
  organizationId: string
  integrationId: string
  // Thread context
  threadId?: string // Optional: If sending creates a new thread
  // Message content
  messageId?: string // RFC Message-ID if pre-generated
  /**
   * Optional — `MessageSenderService.validateInput` enforces it only when the
   * provider's `capabilities.requiresSubject` is set, so chat sends legitimately
   * carry no subject. `Message.subject` is nullable and keeps the real value.
   */
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  signatureId?: string | null
  // Participants
  to: ParticipantInput[]
  cc?: ParticipantInput[]
  bcc?: ParticipantInput[]
  // Draft context
  draftMessageId?: string | null // ID of the draft being sent
  includePreviousMessage?: boolean // Include previous message content
  // Attachments
  attachmentIds?: string[] // MediaAsset IDs to attach
}
/**
 * Participant input data
 */
export interface ParticipantInput {
  identifier: string
  identifierType: IdentifierType
  name?: string
}
/**
 * Thread context for message sending
 * Note: integrationType removed - derive from Integration.provider via integrationId
 */
export interface ThreadContext {
  id: string
  organizationId: string
  integrationId: string
  externalId: string | null
  isPending: boolean
  /**
   * The thread's inbox — realtime routing context for `participant:updated`
   * publishes on the compose path. Optional because the retry path builds a
   * minimal context; absent/null routes to the admin-only `none` channel.
   */
  inboxId?: string | null
  metadata?: Record<string, any>
}
/**
 * Thread state for tracking lifecycle
 */
export enum ThreadState {
  PENDING_CREATION = 'PENDING_CREATION',
  PENDING_SEND = 'PENDING_SEND',
  ACTIVE = 'ACTIVE',
  RECONCILED = 'RECONCILED',
  FAILED = 'FAILED',
}
/**
 * Composed message ready for sending
 */
export interface ComposedMessage {
  id: string
  messageId: string // Internet Message-ID
  sendToken: string
  threadId: string
  /** Nullish for subject-less channels (chat); `Message.subject` is nullable. */
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  references?: string | null
  inReplyTo?: string | null
  participantIds: string[]
}
/**
 * Processed participants with database records
 */
export interface ProcessedParticipants {
  from: ProcessedParticipant
  to: ProcessedParticipant[]
  cc?: ProcessedParticipant[]
  bcc?: ProcessedParticipant[]
  replyTo?: ProcessedParticipant[]
  all: ProcessedParticipant[] // All unique participants
}
/**
 * Participant with database record
 */
export interface ProcessedParticipant {
  id: string
  identifier: string
  identifierType: IdentifierType
  name?: string | null
  displayName?: string | null
  role: ParticipantRole
  /** Linked CRM contact, when the participant resolved to one — carried through from the
   * raw `Participant` row (`ParticipantService.findOrCreateParticipant*`) so send-time
   * suppression checks + the List-Unsubscribe token (MessageSenderService) don't need a
   * second lookup. */
  entityInstanceId?: string | null
  /** Whether this identifier is one of the org's own (channel identity, org domain).
   * Carried through from the raw `Participant` row for the same reason as
   * `entityInstanceId` — the outbound `ThreadParticipant` rollup needs it and must not
   * re-query. Recomputed on every participant upsert since #1655, so it is current. */
  isInternal?: boolean
}
/**
 * Provider send response
 */
export interface ProviderSendResponse {
  success: boolean
  messageId?: string // External message ID from provider
  threadId?: string // External thread ID from provider
  historyId?: string // Gmail history ID for tracking changes
  labelIds?: string[] // Gmail label IDs applied to the message
  error?: string
  timestamp?: Date
  metadata?: Record<string, any>
}
/**
 * Sent message result
 */
export interface SentMessage {
  id: string
  externalId: string
  threadId: string
  subject: string
  sendStatus: SendStatus
  sentAt: Date | null
  /** Sanitized provider failure text, selected alongside the status. */
  providerError?: string | null
  error?: string | null
  /**
   * Resolved participants (id + role) for the sent message, so the client can
   * render the optimistic row with correct from/to/cc immediately instead of a
   * participant-less row that waits on the realtime echo / refetch.
   */
  participants?: { id: string; role: ParticipantRole }[]
  /**
   * Every message this send became, primary first — set only when the provider
   * could not carry it in one message (Meta: one attachment, never beside text;
   * see `splitSendForProvider`).
   *
   * The composer needs it because the originating tab is excluded from its own
   * `message:created` echo (`excludeSocketId`), so its optimistic row is the only
   * thing it sees until a refetch. Without this it would render ONE row carrying
   * both the text and the files, which is not what was sent and not what the
   * customer sees.
   */
  splitMessages?: SplitSentMessage[]
}

/** One message of a split send, as the composer needs to render it. */
export interface SplitSentMessage {
  id: string
  threadId: string
  sentAt: Date | null
  /** The MediaAsset ids this message carried — matched against the staged files. */
  attachmentIds: string[]
  /** Whether this is the part that carried the composed text. */
  hasText: boolean
}
/**
 * Reconciliation input
 */
export interface ReconciliationInput {
  messageId: string
  sendToken: string
  providerResponse: ProviderSendResponse
  threadContext: ThreadContext
  /** Whether to reconcile the thread against an external thread id. False for
   * providers like `chat` that have no external state — the per-message
   * bookkeeping (sendStatus, sentAt, externalId) still runs. Defaults to true. */
  reconcileThread?: boolean
}
/**
 * Post-send sync job
 */
export interface PostSendSyncJob {
  integrationId: string
  type: 'POST_SEND_SYNC'
  priority: 'HIGH' | 'NORMAL' | 'LOW'
  delay?: number // Milliseconds
  metadata?: {
    messageId?: string
    threadId?: string
    sendToken?: string
  }
}
/**
 * Input for retrying a failed message
 */
export interface RetryMessageInput {
  messageId: string
  userId: string
  organizationId: string
}
/**
 * Result of retrying a message
 */
export interface RetryMessageResult {
  success: boolean
  message: SentMessage
  attemptNumber: number
  error?: string
}

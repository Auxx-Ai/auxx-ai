// packages/lib/src/messages/types/message-sending.types.ts
import type { IdentifierType, ParticipantRole, SendStatus } from '@auxx/database/enums'

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
  subject: string
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
  subject: string
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
  error?: string | null
}
/**
 * Reconciliation input
 */
export interface ReconciliationInput {
  messageId: string
  sendToken: string
  providerResponse: ProviderSendResponse
  threadContext: ThreadContext
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

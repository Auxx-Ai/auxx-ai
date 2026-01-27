// packages/lib/src/messages/types/message-query.types.ts

import { MessageType } from '../../providers/types'

/**
 * Draft mode enum for messages.
 */
export type DraftMode = 'NONE' | 'PRIVATE' | 'SHARED'

/**
 * Send status enum for outbound messages.
 */
export type SendStatus = 'PENDING' | 'SENT' | 'FAILED'

/**
 * Re-export MessageType from providers/types for consistent usage.
 */
export { MessageType }

/** Inline sender/recipient summary for display */
export interface ParticipantSummary {
  id: string
  name: string | null
  displayName: string | null
  identifier: string | null
}

/**
 * Attachment metadata for display.
 */
export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string | null
  size: number | null
  url: string | null
}

/**
 * Message metadata for display.
 * Used by the frontend message store for batch-fetched messages.
 */
export interface MessageMeta {
  id: string
  threadId: string
  subject: string | null
  snippet: string | null
  textHtml: string | null
  textPlain: string | null

  isInbound: boolean
  isFirstInThread: boolean
  hasAttachments: boolean

  sentAt: string | null // ISO date
  receivedAt: string | null // ISO date
  createdAt: string // ISO date

  // Inline sender info for display (avoids extra participant fetch)
  from: ParticipantSummary | null
  replyTo: ParticipantSummary | null

  // Sender/recipient as participant IDs (for detail views needing full participant data)
  fromParticipantId: string | null
  replyToParticipantId: string | null

  // Recipients as participant IDs
  toParticipantIds: string[]
  ccParticipantIds: string[]
  bccParticipantIds: string[]

  // Draft state
  draftMode: DraftMode
  createdById: string | null // User ID who created (for drafts)

  // Send status for outbound messages
  sendStatus: SendStatus | null
  providerError: string | null
  attempts: number

  // Attachments
  attachments: AttachmentMeta[]

  // Message type for rendering (EMAIL, CHAT, SMS)
  messageType: MessageType
}

/**
 * Options for listing message IDs for a thread.
 */
export interface ListMessageIdsOptions {
  includeDrafts?: boolean
}

/**
 * Result of listing messages by thread.
 */
export interface ListMessagesByThreadResult {
  ids: string[]
  total: number
}

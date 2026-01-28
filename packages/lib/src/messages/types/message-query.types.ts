// packages/lib/src/messages/types/message-query.types.ts

import type { ParticipantId } from '@auxx/types'
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
 * Simplified structure using ParticipantId[] for all participant references.
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

  /**
   * All participants as tagged IDs.
   * Format: ["from:abc123", "to:xyz789", "cc:def456", "bcc:ghi789", "replyto:jkl012"]
   */
  participants: ParticipantId[]

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
 * Options for listing messages.
 */
export interface ListMessageIdsOptions {
  includeDrafts?: boolean
}

/**
 * Result from listing messages by thread.
 */
export interface ListMessagesByThreadResult {
  messages: MessageMeta[]
  total: number
}

// packages/lib/src/messages/types/message-query.types.ts

import type { ParticipantId } from '@auxx/types'
import { MessageType } from '../../providers/types'

/**
 * Send status enum for outbound messages.
 */
export type SendStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED'

/**
 * Re-export MessageType from providers/types for consistent usage.
 */
export { MessageType }

/**
 * Projection of `Message.metadata.call` (written by `webhook-call.ts`'s `QuoCallMeta`) — the
 * only call/voicemail shape exposed to the client. The raw `metadata` blob (which also carries
 * `quo_webhook_event`) is never sent as-is.
 */
export interface CallMessageMeta {
  direction: 'incoming' | 'outgoing'
  answered: boolean
  answeredAt: string | null
  completedAt: string | null
  durationSeconds: number | null
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
  inline: boolean
  contentId: string | null
}

/**
 * Message metadata for display.
 * Simplified structure using ParticipantId[] for all participant references.
 *
 * Declared as a type alias rather than an interface on purpose: only object-type
 * aliases get an implicit index signature, which is what lets a `MessageMeta`
 * be passed to the generic `redactMessage<T extends Record<string, unknown>>`
 * and come back still typed as `MessageMeta` — no double cast through `unknown`.
 */
export type MessageMeta = {
  id: string
  threadId: string
  subject: string | null
  snippet: string | null
  textHtml: string | null
  textPlain: string | null

  isInbound: boolean
  isFirstInThread: boolean
  hasAttachments: boolean
  hasHtmlBody: boolean
  hasTextBody: boolean

  sentAt: string | null // ISO date
  receivedAt: string | null // ISO date
  createdAt: string // ISO date

  /**
   * All participants as tagged IDs.
   * Format: ["from:abc123", "to:xyz789", "cc:def456", "bcc:ghi789", "replyto:jkl012"]
   */
  participants: ParticipantId[]

  createdById: string | null // User ID who created outbound messages

  // Send status for outbound messages
  sendStatus: SendStatus | null
  providerError: string | null
  attempts: number

  // Attachments
  attachments: AttachmentMeta[]

  // Message type for rendering (EMAIL, CHAT, SMS)
  messageType: MessageType

  /**
   * Call/voicemail detail, projected from `Message.metadata.call` — `null` for every
   * non-CALL/VOICEMAIL message and for a CALL/VOICEMAIL row stored before this projection
   * existed. Never the raw `metadata` blob.
   */
  callMeta?: CallMessageMeta | null
}

/**
 * Options for listing messages.
 */
export type ListMessageIdsOptions = {}

/**
 * Result from listing messages by thread.
 */
export interface ListMessagesByThreadResult {
  messages: MessageMeta[]
  total: number
}

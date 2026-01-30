// apps/web/src/components/mail/email-editor/types.ts
import type { RouterOutputs } from '~/trpc/react'
import { type IdentifierType } from '@auxx/database/types'

/** Message type with all fields needed for display */
export interface MessageType {
  id: string
  threadId: string
  subject: string | null
  snippet: string | null
  textHtml: string | null
  textPlain: string | null
  isInbound: boolean
  sentAt: Date | null
  createdAt: Date
  messageType: 'EMAIL' | 'CHAT' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE' | 'SMS'
  from?: {
    id: string
    identifier: string
    name: string | null
    displayName?: string | null
  } | null
  participants?: Array<{
    role: string
    participant: {
      id: string
      identifier: string
      identifierType: string
      name: string | null
    }
  }>
  signature?: { id: string; name: string } | null
  attachments?: Array<{
    id: string
    filename: string
    contentType: string | null
    size: number | null
  }>
  sendStatus?: string | null
  providerError?: string | null
  attempts?: number | null
  lastAttemptAt?: Date | null
}

/** Draft message format (from Draft table, transformed) */
export interface DraftMessageType {
  id: string
  threadId: string | null
  subject: string
  textHtml: string
  textPlain: string
  signatureId: string | null
  participants: Array<{
    role: 'TO' | 'CC' | 'BCC'
    participant: {
      id: string
      identifier: string
      identifierType: string
      name: string | null
    }
  }>
  attachments: Array<{
    id: string
    name: string
    size?: number
    mimeType?: string
    type: 'file' | 'asset'
  }>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  from?: {
    id: string
    identifier: string
    name: string | null
    displayName?: string | null
  } | null
  sentAt?: Date | null
}

/** Full thread with details for email display */
export interface ThreadWithDetails {
  id: string
  subject: string
  organizationId: string
  status: string
  lastMessageAt?: Date | null
  firstMessageAt?: Date | null
  messageCount: number
  participantCount: number
  assigneeId?: string | null
  createdAt: Date
  labels?: Array<{ label: { id: string; name: string } }>
  assignee?: { id: string; name: string | null } | null
  integration?: { provider: string } | null
  messages: MessageType[]
  isUnread?: boolean
  messageType: string
  draftMessage: DraftMessageType | null
}

// Server-authoritative draft message type (persisted fields only)
// Now comes from the new draft router
export type DraftMessage = RouterOutputs['draft']['upsert']
// Client submit payload for drafts
export type DraftPayload = {
  threadId: string | null
  integrationId: string
  subject: string
  textHtml: string
  signatureId: string | null
  to: Array<{
    identifier: string
    identifierType: IdentifierType
    name?: string
  }>
  cc: Array<{
    identifier: string
    identifierType: IdentifierType
    name?: string
  }>
  bcc: Array<{
    identifier: string
    identifierType: IdentifierType
    name?: string
  }>
  attachments?: FileAttachment[]
  metadata: {
    includePreviousMessage: boolean
    sourceMessageId?: string | null
  }
  draftId?: string | null
}
// File attachment type for structured attachments
export type FileAttachment = {
  id: string
  name: string
  size?: number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}
// Local attachment with client-only fields for upload state
export type LocalAttachment = FileAttachment & {
  status?: 'pending' | 'uploaded' | 'failed'
  clientId?: string
  progress?: number
}

export type EditorMode = 'reply' | 'replyAll' | 'forward' | 'new' | 'draft'
export interface RecipientState {
  id: string
  identifier: string
  identifierType: IdentifierType
  name?: string | null
}

export type Recipients = {
  TO: RecipientState[]
  CC: RecipientState[]
  BCC: RecipientState[]
}
export interface DraftMetadata {
  includePreviousMessage?: boolean
  sourceMessageId?: string
}
export type ParticipantInputData = {
  identifier: string
  identifierType: IdentifierType
  name?: string | undefined
}

/**
 * Preset values for initializing the email editor programmatically.
 * These values override the default derived state but are ignored if a draft exists.
 */
export interface EditorPresetValues {
  /** Preset TO recipients */
  to?: RecipientState[]
  /** Preset CC recipients */
  cc?: RecipientState[]
  /** Preset BCC recipients */
  bcc?: RecipientState[]
  /** Preset subject line */
  subject?: string
  /** Preset content HTML */
  contentHtml?: string
  /** Preset sender integration ID */
  integrationId?: string
  /** Preset signature ID */
  signatureId?: string | null
  /** Preset file attachments (must reference existing uploaded files) */
  attachments?: FileAttachment[]
  /** Whether to include previous message */
  includePreviousMessage?: boolean
  /** Source message for reply context */
  sourceMessage?: MessageType | null
}

export interface ReplyComposeEditorProps {
  thread?: ThreadWithDetails | null
  sourceMessage?: MessageType | null
  draftMessage?: DraftMessageType | null
  mode: EditorMode
  onClose: () => void
  onSendSuccess: () => void
  /** Optional preset values to initialize the editor with */
  presetValues?: EditorPresetValues
}

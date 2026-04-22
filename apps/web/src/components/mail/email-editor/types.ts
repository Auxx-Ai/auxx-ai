// apps/web/src/components/mail/email-editor/types.ts

import type { IdentifierType } from '@auxx/database/types'
import type { RouterOutputs } from '~/trpc/react'

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
    identifierType: string
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
  /** ID of the message this draft is replying to (permanent reference) */
  inReplyToMessageId: string | null
  /** Whether to include previous message in reply (user preference, toggleable) */
  includePreviousMessage: boolean
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
  actions?: Array<{
    appId: string
    installationId: string
    actionId: string
    inputs: Record<string, unknown>
    display: {
      label: string
      icon?: string
      color?: string
      summary: string
    }
  }>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  from?: {
    id: string
    identifier: string
    identifierType: string
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
  /** ID of the message this draft is replying to (permanent reference) */
  inReplyToMessageId?: string | null
  /** Whether to include previous message in reply (user preference, toggleable) */
  includePreviousMessage?: boolean
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
  actions?: Array<{
    appId: string
    installationId: string
    actionId: string
    inputs: Record<string, unknown>
    display: {
      label: string
      icon?: string
      color?: string
      summary: string
    }
  }>
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
/** @deprecated Use top-level fields on DraftMessageType instead */
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
  /** Auto-link the new thread to this ticket after send */
  linkTicketId?: string
}

/** Minimal thread data needed by the editor */
export interface EditorThread {
  id: string
  subject?: string
  integrationId?: string
  messages?: MessageType[]
}

export interface ReplyComposeEditorProps {
  thread?: EditorThread | null
  sourceMessage?: MessageType | null
  /** Draft to load into the editor */
  draft?: DraftMessageType | null
  mode: EditorMode
  onClose: () => void
  onSendSuccess: () => void
  /** Optional preset values to initialize the editor with */
  presetValues?: EditorPresetValues
  /** When true, X button closes dialog (preserving draft) and separate delete button is shown */
  isDialogMode?: boolean
  /** Called when the user clicks the pop-out button (inline mode only) */
  onPopOut?: () => void
  /** Called when the user clicks the minimize button (floating mode only) */
  onMinimize?: () => void
  /** Called when the user clicks the dock-back button (floating mode, thread is visible) */
  onDockBack?: () => void
  /** Called when the subject field changes (for tracking in minimized bar) */
  onSubjectChange?: (subject: string) => void
  /** Compose instance ID for store interactions (e.g. pending focus) */
  instanceId?: string
}

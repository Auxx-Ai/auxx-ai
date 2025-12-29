// apps/web/src/components/mail/email-editor/types.ts
import type { RouterOutputs } from '~/trpc/react'
import { type IdentifierType } from '@auxx/database/types'

export type ThreadWithDetails = RouterOutputs['thread']['getById']
export type DraftMessageType = Exclude<ThreadWithDetails['draftMessage'], null>
export type MessageType = ThreadWithDetails['messages'][number]
// Server-authoritative draft message type (persisted fields only)
export type DraftMessage = RouterOutputs['thread']['createOrUpdateDraft']
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

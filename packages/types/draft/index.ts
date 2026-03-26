// packages/types/draft/index.ts

import type { IdentifierType } from '@auxx/database/types'

/**
 * Participant reference stored in draft content.
 * Denormalized for fast saves - full participant lookup happens at send time.
 */
export interface DraftParticipant {
  /** Participant table ID (if known) */
  participantId?: string
  /** Email address or phone number */
  identifier: string
  /** Type of identifier */
  identifierType: IdentifierType
  /** Display name */
  name?: string | null
}

/**
 * Attachment reference stored in draft content.
 * References File/MediaAsset records - actual file data is stored elsewhere.
 */
export interface DraftAttachment {
  /** File or MediaAsset ID */
  id: string
  /** Original filename */
  name: string
  /** Size in bytes */
  size: number
  /** MIME type */
  mimeType: string
  /** Source type: 'file' = FolderFile, 'asset' = MediaAsset */
  type: 'file' | 'asset'
}

/**
 * Complete draft content structure stored as JSON in the Draft table.
 * All fields are optional to support incremental autosave.
 */
export interface DraftContent {
  /** Email subject */
  subject?: string | null

  /** HTML body content */
  bodyHtml?: string | null

  /** Plain text body content */
  bodyText?: string | null

  /** Sender participant (usually the integration's email) */
  from?: DraftParticipant | null

  /** Reply-to participant */
  replyTo?: DraftParticipant | null

  /** Recipients organized by role */
  recipients: {
    to: DraftParticipant[]
    cc: DraftParticipant[]
    bcc: DraftParticipant[]
  }

  /** File attachments */
  attachments: DraftAttachment[]

  /** Signature ID to include when sending */
  signatureId?: string | null

  /** Whether to include previous message in reply (user preference, toggleable) */
  includePreviousMessage?: boolean

  /** Additional metadata (for truly arbitrary client-specific data) */
  metadata?: Record<string, unknown>
}

/**
 * Default empty draft content.
 * Used when creating new drafts.
 */
export const DEFAULT_DRAFT_CONTENT: DraftContent = {
  subject: null,
  bodyHtml: null,
  bodyText: null,
  from: null,
  replyTo: null,
  recipients: {
    to: [],
    cc: [],
    bcc: [],
  },
  attachments: [],
  signatureId: null,
  includePreviousMessage: false,
}

/**
 * Draft entity as returned from database queries.
 * Combines table columns with typed content.
 */
export interface Draft {
  id: string
  organizationId: string
  createdById: string
  threadId: string | null
  inReplyToMessageId: string | null
  integrationId: string
  content: DraftContent
  providerId: string | null
  providerThreadId: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Input for creating a new draft.
 */
export interface CreateDraftInput {
  integrationId: string
  threadId?: string | null
  inReplyToMessageId?: string | null
  content?: Partial<DraftContent>
}

/**
 * Input for updating an existing draft.
 */
export interface UpdateDraftInput {
  draftId: string
  content: Partial<DraftContent>
  /** Optional - only set if provided (for lazy migration from metadata.sourceMessageId) */
  inReplyToMessageId?: string | null
}

/**
 * Input for upserting a draft (create or update).
 */
export interface UpsertDraftInput {
  draftId?: string | null
  integrationId: string
  threadId?: string | null
  inReplyToMessageId?: string | null
  content: Partial<DraftContent>
}

/**
 * Metadata for standalone drafts (drafts without a threadId).
 * Used for displaying standalone drafts in the thread list.
 */
export interface StandaloneDraftMeta {
  /** Draft ID */
  id: string
  /** Integration ID for the email account */
  integrationId: string
  /** Integration provider (GMAIL, OUTLOOK, etc.) */
  integrationProvider: 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE' | null
  /** Email subject */
  subject: string | null
  /** Body snippet (first ~100 chars of body text) */
  snippet: string | null
  /** Summary of recipients (e.g., "john@example.com +2") */
  recipientSummary: string | null
  /** Last update time (ISO date string) */
  updatedAt: string
  /** Creation time (ISO date string) */
  createdAt: string
  /** If this draft has a pending scheduled send, the ISO date it's scheduled for */
  scheduledAt: string | null
}

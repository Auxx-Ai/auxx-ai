// packages/lib/src/ingest/types.ts

type JsonValue = any
type JsonArray = any

/**
 * Structure for participant info provided by provider conversion methods.
 * Flat object; `identifier` is the raw email/phone/PSID/etc.
 */
export interface ParticipantInputData {
  identifier: string
  name?: string | null
  raw?: string | null
}

/** Provider-side attachment metadata for downstream ingest (not persisted in DB). */
export interface MessageAttachmentMeta {
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId: string | null
  /** Gmail: body.attachmentId for large parts; null for embedded parts */
  providerAttachmentId?: string | null
  /** Gmail: base64url-encoded body.data for small embedded parts */
  embeddedData?: string | null
}

/** Structure for message data coming from provider conversion methods. */
export interface MessageData {
  externalId: string
  externalThreadId: string
  inboxId?: string
  integrationId: string
  organizationId: string

  isInbound: boolean
  subject?: string | null
  textHtml?: string | null
  textPlain?: string | null
  snippet?: string | null
  metadata?: JsonValue | null
  createdTime: Date
  sentAt: Date
  receivedAt: Date

  from: ParticipantInputData
  to: ParticipantInputData[]
  cc?: ParticipantInputData[]
  bcc?: ParticipantInputData[]
  replyTo?: ParticipantInputData[]

  hasAttachments: boolean

  /** Object-backed body storage (set by ingest pipeline). */
  htmlBodyStorageLocationId?: string | null

  historyId?: number | null
  internetMessageId?: string | null
  keywords?: string[]
  labelIds?: string[]
  inReplyTo?: string | null
  references?: string | null
  threadIndex?: string | null
  folderId?: string | null
  internetHeaders?: JsonArray | null
  isAutoReply?: boolean | null
  isFirstInThread?: boolean | null
  isAIGenerated?: boolean | null

  providerAttachments?: MessageAttachmentMeta[]
}

/** Per-integration record-creation + filter settings, stored in Integration.metadata.settings. */
export interface IntegrationSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  excludeSenders?: string[]
  excludeRecipients?: string[]
  onlyProcessRecipients?: string[]
  [key: string]: any
}

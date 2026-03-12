// packages/lib/src/email/inbound/ingest-types.ts

/**
 * Raw attachment input for the inbound ingest pipeline.
 */
export interface AttachmentIngestInput {
  content: Buffer
  filename: string
  mimeType: string
  inline: boolean
  contentId?: string | null
  attachmentOrder: number
}

/**
 * Context required for ingesting attachments into the canonical Attachment system.
 * Attachment ingest happens after the message row exists.
 */
export interface AttachmentIngestContext {
  organizationId: string
  messageId: string
  contentScopeId: string
  createdById?: string | null
}

/**
 * Result of ingesting the HTML body into object storage.
 */
export interface IngestedBodyMeta {
  htmlBodyStorageLocationId?: string | null
}

/**
 * Metadata for a single attachment after it has been ingested and stored.
 */
export interface StoredAttachmentMeta {
  attachmentId: string
  assetId: string
  assetVersionId: string
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId: string | null
  attachmentOrder: number
}

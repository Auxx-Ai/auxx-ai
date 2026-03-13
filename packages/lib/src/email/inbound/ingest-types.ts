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

/**
 * Per-message failure detail returned by storeBatchWithIngest.
 */
export interface IngestFailure {
  externalId: string
  error: string
  retriable: boolean
}

/**
 * Structured result from storeBatchWithIngest.
 */
export interface BatchIngestResult {
  storedCount: number
  failedCount: number
  failedExternalIds: string[]
  retriableFailures: IngestFailure[]
  nonRetriableFailures: IngestFailure[]
}

/**
 * Classify whether an ingest error is likely retriable.
 * DB connection errors, timeouts, and rate limits are retriable.
 * Validation errors and constraint violations are not.
 */
export function isRetriableIngestError(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  const msg = error.message.toLowerCase()
  if (msg.includes('connection') || msg.includes('timeout') || msg.includes('econnrefused')) {
    return true
  }
  if (msg.includes('rate limit') || msg.includes('too many')) return true
  if (msg.includes('constraint') || msg.includes('unique') || msg.includes('validation')) {
    return false
  }
  // Default to retriable for unknown errors
  return true
}

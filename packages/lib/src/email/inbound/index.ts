// packages/lib/src/email/inbound/index.ts

export { InboundAttachmentAccessService } from './attachment-access.service'
export { InboundAttachmentIngestService } from './attachment-ingest.service'
export { InboundBodyAccessService } from './body-access.service'
export { InboundBodyIngestService } from './body-ingest.service'
export { InboundChannelResolver } from './channel-resolver'
export { PermanentProcessingError } from './errors'
export { InboundEmailProcessor } from './inbound-email-processor'
export type {
  AttachmentIngestContext,
  AttachmentIngestInput,
  BatchIngestResult,
  IngestedBodyMeta,
  IngestFailure,
  StoredAttachmentMeta,
} from './ingest-types'
export { isRetriableIngestError } from './ingest-types'
export {
  buildInboundAttachmentKey,
  buildInboundHtmlBodyKey,
  deriveAttachmentId,
} from './object-keys'
export { RawEmailParser } from './raw-email-parser'
export { S3RawEmailStore } from './s3-raw-email'
export { assertSenderAllowed } from './sender-allowlist-guard'
export type {
  ForwardingIntegrationMetadata,
  InboundEmailAddress,
  InboundEmailAttachment,
  ParsedInboundEmail,
  RawEmailStore,
  ResolvedInboundIntegration,
  SesInboundQueueMessage,
} from './types'

// packages/lib/src/email/inbound/index.ts

export { InboundAttachmentAccessService } from './attachment-access.service'
export { InboundAttachmentIngestService } from './attachment-ingest.service'
export { InboundBodyAccessService } from './body-access.service'
export { InboundBodyIngestService } from './body-ingest.service'
export { PermanentProcessingError } from './errors'
export { InboundEmailProcessor } from './inbound-email-processor'
export type {
  AttachmentIngestContext,
  AttachmentIngestInput,
  IngestedBodyMeta,
  StoredAttachmentMeta,
} from './ingest-types'
export { InboundIntegrationResolver } from './integration-resolver'
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

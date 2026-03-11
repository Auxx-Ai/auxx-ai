// packages/lib/src/email/inbound/index.ts

export { InboundEmailProcessor } from './inbound-email-processor'
export { InboundIntegrationResolver } from './integration-resolver'
export { RawEmailParser } from './raw-email-parser'
export { S3RawEmailStore } from './s3-raw-email'
export { assertSenderAllowed } from './sender-allowlist-guard'
export type {
  ForwardingIntegrationMetadata,
  InboundEmailAddress,
  InboundEmailAttachment,
  ParsedInboundEmail,
  ResolvedInboundIntegration,
  SesInboundQueueMessage,
} from './types'

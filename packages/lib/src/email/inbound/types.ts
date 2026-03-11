// packages/lib/src/email/inbound/types.ts

/**
 * RawEmailStore fetches a raw MIME payload by bucket/key identifier.
 */
export interface RawEmailStore {
  getRawEmailString(bucket: string, key: string): Promise<string>
}

/**
 * SesInboundQueueMessage is the compact SQS payload produced by the SES bridge Lambda.
 */
export interface SesInboundQueueMessage {
  version: 1
  provider: 'ses'
  sesMessageId: string
  s3Bucket: string
  s3Key: string
  recipients: string[]
  receivedAt: string
}

/**
 * InboundEmailAddress is a normalized mailbox parsed from raw MIME.
 */
export interface InboundEmailAddress {
  address: string
  name?: string | null
}

/**
 * InboundEmailAttachment is the normalized attachment shape for inbound processing.
 */
export interface InboundEmailAttachment {
  filename: string
  mimeType: string
  size: number
  inline: boolean
  contentId?: string | null
  content?: string | null
}

/**
 * ParsedInboundEmail is the normalized MIME output used by the inbound processor.
 */
export interface ParsedInboundEmail {
  subject: string | null
  textPlain: string | null
  textHtml: string | null
  snippet: string | null
  from: InboundEmailAddress | null
  to: InboundEmailAddress[]
  cc: InboundEmailAddress[]
  bcc: InboundEmailAddress[]
  replyTo: InboundEmailAddress[]
  internetMessageId: string | null
  inReplyTo: string | null
  references: string | null
  sentAt: Date | null
  headers: Record<string, string | string[]>
  attachments: InboundEmailAttachment[]
}

/**
 * ForwardingIntegrationMetadata captures the forwarding-specific metadata stored on Integration.metadata.
 */
export interface ForwardingIntegrationMetadata {
  channelType?: 'forwarding-address'
  systemManaged?: boolean
  ingressProvider?: 'ses-s3-sqs'
  allowedSenders?: string[]
  [key: string]: unknown
}

/**
 * ResolvedInboundIntegration is the resolved org/integration target for one inbound recipient.
 */
export interface ResolvedInboundIntegration {
  organizationId: string
  integrationId: string
  inboxId: string | null
  matchedRecipient: string
  integrationEmail: string | null
  metadata: ForwardingIntegrationMetadata
  allowedSenders: string[]
}

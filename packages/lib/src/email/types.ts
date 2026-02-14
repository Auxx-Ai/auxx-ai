// packages/lib/src/email/types.ts

/**
 * Common interface for all email providers (Mailgun, SES, Nodemailer-backed, etc.)
 */
export interface EmailProvider {
  /** Unique identifier for the provider */
  id: string

  /** Optional initialization step for provider setup */
  init?(config?: unknown): Promise<void> | void

  /** Send an email through the provider */
  sendEmail(options: EmailOptions): Promise<EmailResult>

  /** Verify webhook signature for incoming webhooks */
  verifyWebhookSignature?(signature: string, token: string, timestamp: string): Promise<boolean>

  /** Get DKIM records for domain verification */
  getDkimRecord?(domain: string): Promise<DkimRecord | null>

  /** Create a new domain for sending emails */
  createDomain?(domain: string): Promise<boolean>

  /** Delete a domain from the provider */
  deleteDomain?(domain: string): Promise<boolean>
}

/**
 * Options for sending an email
 */
export interface EmailOptions {
  /** Sender email address */
  from: string

  /** Recipient email address(es) */
  to: string | string[]

  /** Email subject line */
  subject: string

  /** Plain text version of the email */
  text?: string

  /** HTML version of the email */
  html?: string

  /** Message-ID of the email being replied to */
  inReplyTo?: string

  /** List of Message-IDs for threading */
  references?: string | string[]

  /** Custom Message-ID for the email */
  messageId?: string

  /** File attachments */
  attachments?: Attachment[]

  /** Enable tracking (opens, clicks) */
  trackingEnabled?: boolean

  /** Custom headers */
  headers?: Record<string, string>

  /** Reply-to email address */
  replyTo?: string

  /** CC recipients */
  cc?: string | string[]

  /** BCC recipients */
  bcc?: string | string[]

  /** Email tags for categorization */
  tags?: string[]
}

/**
 * Result of sending an email
 */
export interface EmailResult {
  /** Provider-specific message ID */
  id: string

  /** Whether the email was successfully sent */
  success: boolean

  /** Error message if sending failed */
  error?: string

  /** Provider-specific response data */
  raw?: unknown
}

/**
 * Email attachment
 */
export interface Attachment {
  /** File name */
  filename: string

  /** File content (Buffer or string) */
  content: Buffer | string

  /** MIME type */
  contentType?: string

  /** Content ID for inline attachments */
  cid?: string

  /** Encoding type */
  encoding?: string
}

/**
 * DKIM record for domain verification
 */
export interface DkimRecord {
  /** Record name/selector */
  name: string

  /** Record type (usually TXT) */
  type: string

  /** Record value */
  value: string

  /** TTL for the DNS record */
  ttl?: number
}

/**
 * Bounce event from webhook
 */
export interface BounceEvent {
  /** Type of bounce (hard, soft, etc.) */
  type: 'hard' | 'soft' | 'transient'

  /** Email address that bounced */
  email: string

  /** Timestamp of the bounce */
  timestamp: Date

  /** Bounce reason/message */
  reason?: string

  /** Provider-specific data */
  raw?: unknown
}

/**
 * Complaint event from webhook
 */
export interface ComplaintEvent {
  /** Type of complaint (spam, abuse, etc.) */
  type: string

  /** Email address that complained */
  email: string

  /** Timestamp of the complaint */
  timestamp: Date

  /** Provider-specific data */
  raw?: unknown
}

/**
 * Delivery event from webhook
 */
export interface DeliveryEvent {
  /** Email address delivered to */
  email: string

  /** Timestamp of delivery */
  timestamp: Date

  /** Provider-specific data */
  raw?: unknown
}

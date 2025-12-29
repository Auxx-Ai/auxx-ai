import { z } from 'zod'

export const ZUserEmail = z.email({ message: 'Invalid email' })

export type UserEmail = z.infer<typeof ZUserEmail>

export interface SendEmailDataProps {
  to: string
  replyTo?: string
  subject: string
  text?: string
  html: string
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

// packages/lib/src/providers/email/types.ts

import type { EmailOptions, EmailResult } from '@auxx/email'

/**
 * A DNS record published for a sending domain (DKIM/SPF verification).
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
 * Transactional email provider — sends mail and, optionally, manages the
 * sending domain (creation, routing, DKIM) on the vendor's side.
 *
 * Only the sending surface is required; domain management is optional because
 * not every provider owns the domain lifecycle.
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

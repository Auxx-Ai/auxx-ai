// packages/lib/src/providers/google/types.ts
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../utils/rate-limiter'

/**
 * Google integration metadata structure
 */
export interface GoogleIntegration {
  id: string
  provider: 'google'
  enabled: boolean
  refreshToken: string
  accessToken: string | null
  expiresAt: Date | null
  lastHistoryId: string | null
  lastSyncedAt: Date | null
  metadata: GoogleIntegrationMetadata
  inboxIntegration?: {
    inboxId: string
  } | null
}

/**
 * Metadata stored in integration.metadata field
 */
export interface GoogleIntegrationMetadata {
  email?: string
  userEmails?: string[]
  lastEmailsFetch?: string
  settings?: any
  watchExpiration?: string
}

/**
 * Common input for Gmail API operations
 */
export interface GmailOperationContext {
  gmail: gmail_v1.Gmail
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Parsed Gmail message structure
 */
export interface ParsedGmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  historyId: string
  internalDate: string
  attachments: any[]
  headers: Record<string, string>
  textPlain?: string
  textHtml?: string
  [key: string]: any
}

/**
 * Gmail message with required payload
 */
export interface GmailMessageWithPayload extends gmail_v1.Schema$Message {
  id: string
  threadId: string
  payload: gmail_v1.Schema$MessagePart
}

/**
 * Throttler context for Gmail operations
 */
export type GoogleThrottleContext = 'sync' | 'history' | 'batch' | 'send' | 'webhook' | 'labels'

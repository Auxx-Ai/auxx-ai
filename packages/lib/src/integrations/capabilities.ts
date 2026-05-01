// packages/lib/src/integrations/capabilities.ts

import { IntegrationProviderType } from '@auxx/database/enums'

/**
 * Coarse, kopilot-facing capability map for an integration platform. This is
 * deliberately separate from `provider-capabilities.ts` (which is the detailed
 * runtime capability matrix) — the LLM only needs to know which channel each
 * integration is, what shape its recipients take, and which write affordances
 * the catalog should advertise.
 */
export interface PlatformCapabilities {
  channel: 'email' | 'messaging'
  /** Can a brand-new outbound conversation be started (no existing thread). */
  newOutbound: boolean
  /** Can the platform reply on an existing thread. */
  threadReply: boolean
  /** Whether `subject` is a meaningful arg on this channel. */
  subject: boolean
  /** Whether CC/BCC are valid (email only). */
  ccBcc: boolean
  /** Whether server-side drafts persist on this platform. */
  drafts: boolean
  /** Whether file attachments are supported. */
  attachments: boolean
  /**
   * Shape of identifier the platform sends to. `thread_only` means a brand-new
   * outbound is not possible (replies only — Facebook/Instagram DMs require an
   * inbound message first to open the customer-service window).
   */
  recipientModel: 'email' | 'phone' | 'platform_user' | 'thread_only'
  /** Free-form note surfaced to the LLM in the catalog stanza. */
  notes?: string
}

/**
 * Static capability map keyed by `IntegrationProviderType` enum values
 * (mirrors `packages/database/src/db/schema/_shared.ts`).
 */
export const PLATFORM_CAPABILITIES: Record<IntegrationProviderType, PlatformCapabilities> = {
  [IntegrationProviderType.google]: {
    channel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    recipientModel: 'email',
  },
  [IntegrationProviderType.outlook]: {
    channel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    recipientModel: 'email',
  },
  [IntegrationProviderType.email]: {
    channel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    recipientModel: 'email',
  },
  [IntegrationProviderType.imap]: {
    channel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    recipientModel: 'email',
  },
  [IntegrationProviderType.mailgun]: {
    channel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    recipientModel: 'email',
  },
  [IntegrationProviderType.facebook]: {
    channel: 'messaging',
    newOutbound: false,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    recipientModel: 'thread_only',
    notes: '24h customer-service window for freeform replies',
  },
  [IntegrationProviderType.instagram]: {
    channel: 'messaging',
    newOutbound: false,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    recipientModel: 'thread_only',
  },
  [IntegrationProviderType.sms]: {
    channel: 'messaging',
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: false,
    recipientModel: 'phone',
  },
  [IntegrationProviderType.openphone]: {
    channel: 'messaging',
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: false,
    recipientModel: 'phone',
  },
  [IntegrationProviderType.whatsapp]: {
    channel: 'messaging',
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    recipientModel: 'phone',
    notes: 'cold sends require approved template',
  },
  [IntegrationProviderType.chat]: {
    channel: 'messaging',
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    recipientModel: 'platform_user',
  },
  [IntegrationProviderType.shopify]: {
    // Data-only integration — not a messaging channel. Excluded from the
    // catalog by callers via `channel` filter or `newOutbound + threadReply`.
    channel: 'messaging',
    newOutbound: false,
    threadReply: false,
    subject: false,
    ccBcc: false,
    drafts: false,
    attachments: false,
    recipientModel: 'thread_only',
    notes: 'data-only integration, not a messaging channel',
  },
}

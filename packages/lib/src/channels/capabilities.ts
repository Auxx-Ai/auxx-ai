// packages/lib/src/channels/capabilities.ts

import { IntegrationProviderType } from '@auxx/database/enums'
import type { IntegrationProviderType as IntegrationProviderTypeValue } from '@auxx/database/types'

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
 * The subset of `PlatformCapabilities` the composer UI reads.
 *
 * Deliberately a `Pick`, never a second literal: a new channel type is
 * described in exactly ONE place (`PLATFORM_CAPABILITIES` below), and the
 * front end plucks what it needs. Widening this type is how a new UI
 * affordance gets wired — adding a per-provider value anywhere else is how
 * the two maps in `provider-capabilities.ts` and here drifted apart.
 */
export type ComposerCapabilities = Pick<
  PlatformCapabilities,
  'channel' | 'newOutbound' | 'threadReply' | 'subject' | 'ccBcc' | 'attachments' | 'recipientModel'
>

/**
 * Which channels a From picker should offer.
 *
 * - `email` — email-shaped surfaces (sequences, quotes/invoices, dispatch
 *   notifications). These build a subject + HTML body and cannot degrade.
 * - `addressable` — anything a human can start a new conversation on by
 *   typing an identifier. Email **and** phone.
 */
export type ChannelSelectionScope = 'email' | 'addressable'

/**
 * Static capability map keyed by `IntegrationProviderType` enum values
 * (mirrors `packages/database/src/db/schema/_shared.ts`).
 */
export const PLATFORM_CAPABILITIES: Record<IntegrationProviderTypeValue, PlatformCapabilities> = {
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
    // Quo has no drafts API — the surface is List messages / Send a text /
    // Get a message by ID, nothing else. Matches `provider-capabilities.ts`
    // (`canDraft: false`, `createDraft()` returning `{ success: false }`).
    // LOCAL drafts (our own DB row) are a different mechanism and do NOT read
    // this flag; this one only advertises server-side draft persistence.
    drafts: false,
    // Quo's send schema is `content`/`from`/`to` (+ optional `userId`,
    // deprecated `phoneNumberId`, `setInboxStatus`) — no media field at all.
    // Outbound MMS is a platform limitation, not a gap on our side.
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

/** Plucks the composer-facing subset for one provider. `undefined` for an unknown provider. */
export function getComposerCapabilities(provider: string): ComposerCapabilities | undefined {
  return PLATFORM_CAPABILITIES[provider as IntegrationProviderTypeValue]
}

/**
 * Can a channel of this provider be the From of a **new** outbound message?
 *
 * `newOutbound` alone is not enough: `chat` declares it but addresses a
 * `platform_user`, which the composer has no input for — picking it would
 * render a composer with no recipient field and no way to send. So the
 * recipient model must also be one the composer can actually collect.
 *
 * Excluded by this rule today: `facebook`/`instagram` (`thread_only` — reply
 * only, inside the 24h customer-service window), `chat` (`platform_user`),
 * `shopify` (not a messaging channel at all).
 */
export function canStartOutbound(provider: string, scope: ChannelSelectionScope): boolean {
  const caps = getComposerCapabilities(provider)
  if (!caps?.newOutbound) return false
  if (scope === 'email') return caps.recipientModel === 'email'
  return caps.recipientModel === 'email' || caps.recipientModel === 'phone'
}

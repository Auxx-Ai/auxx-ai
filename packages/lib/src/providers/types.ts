// packages/lib/src/providers/types.ts

import { IntegrationProviderType } from '@auxx/database/enums'

/**
 * Centralized provider type definitions for consistent usage across the codebase
 * This file serves as the single source of truth for provider type mapping
 */
/**
 * Defines the capabilities of a message provider
 */
export interface ProviderCapabilities {
  // Message operations
  canSend: boolean
  canReply: boolean
  canForward: boolean
  canDraft: boolean
  canDelete: boolean
  canArchive: boolean
  canMarkSpam: boolean
  canMarkTrash: boolean
  canSearch: boolean

  // Label/Tag operations
  canApplyLabel: boolean
  canRemoveLabel: boolean
  canCreateLabel: boolean
  labelScope: 'none' | 'message' | 'thread' | 'conversation'

  // Thread operations
  canManageThreads: boolean
  canAssignThreads: boolean
  canBulkOperations: boolean

  // Attachment operations
  canAttachFiles: boolean
  maxAttachmentSize?: number // in bytes
  supportedAttachmentTypes?: string[]
  /**
   * How many attachments one message on this provider can carry. Undefined = no
   * per-message limit (email).
   *
   * Meta's Send API takes exactly one, which is why this exists: a composer send
   * that exceeds it is SPLIT into several messages by `MessageSenderService`
   * rather than truncated, so every provider id we are handed back belongs to a
   * row of ours and ingest can dedupe it on the next sync.
   */
  maxAttachmentsPerMessage?: number
  /**
   * Whether one message can carry text AND an attachment. Undefined = yes.
   *
   * False on Meta: its `message` object takes `text` or `attachment`, never both,
   * so a caption and a photo are two messages.
   */
  canSendTextWithAttachment?: boolean

  // Special features
  canScheduleSend: boolean
  canTrackOpens: boolean
  canUseTemplates: boolean
  canReact: boolean // for social media
  canShare: boolean // for social media

  /**
   * Whether a user may connect this channel as a PERSONAL account
   * (mail-permissions §11) — a user-scoped credential feeding a dedicated
   * personal inbox. Email-likes only; the chat widget, social DMs, and phone
   * lines are org assets. The connect path enforces this server-side (fail
   * closed), independent of the wizard UI.
   */
  supportsPersonalConnection: boolean

  /**
   * Whether inbound messages on this provider's channels run through the
   * MAIL FILTER engine (mail-filters plan D17 / invariant 17).
   *
   * Email-likes only in v1 — the filter field catalog is
   * `MAIL_VIEW_FIELD_DEFINITIONS` (subject / from / to / attachments / body),
   * which is an email vocabulary; chat, social DMs and SMS need a field-catalog
   * pass before this flips for them.
   *
   * ⚠️ This gates RUNTIME BEHAVIOR, which is why it lives here and not on
   * `PLATFORM_CAPABILITIES` — that one only describes a channel to the LLM.
   * `getProviderCapabilities`' fully-false default means an unknown provider
   * fails closed.
   */
  supportsMailFilters: boolean

  /**
   * Whether this provider can mirror Auxx thread status/read changes back to
   * the provider mailbox (bidirectional status sync). Personal inboxes only,
   * and gated per-channel by `ChannelSettings.bidirectionalSyncEnabled`. Gmail
   * only for now; other email-likes can opt in by flipping this preset.
   */
  supportsBidirectionalStatusSync: boolean

  // Send-pipeline shape — drives MessageSenderService.validateInput, usage guard,
  // and post-send sync. Email-likes are all `true`; chat is all `false`. FB/IG
  // are currently `true` for compatibility — see provider-capabilities.ts.
  requiresSubject: boolean
  requiresRecipients: boolean
  countsAgainstOutboundEmailsQuota: boolean
  triggersPostSendSync: boolean
  /** Whether the send pipeline should reconcile the local message against a
   * provider response (externalThreadId, internetMessageId, etc.). False for
   * providers like `chat` that have no external state — the provider echoes
   * our local ids back and reconciling would clobber thread metadata. */
  requiresSendReconciliation: boolean
  supportsRichText: boolean

  // Rate limiting
  rateLimits?: {
    messagesPerMinute?: number
    messagesPerHour?: number
    messagesPerDay?: number
  }

  // Provider-specific metadata
  metadata?: Record<string, any>
}

/**
 * Channel Provider Types
 *
 * Aliased directly onto the generated `IntegrationProviderType` enum object so
 * this can never drift from the `IntegrationProviderType` pgEnum backing
 * `Integration.provider`. Usable as a value (`ChannelProviderType.google`) and
 * as a type, and — unlike a TS `enum` — a bare `'google'` read straight off a
 * Drizzle row is assignable to it.
 *
 * Members: google | outlook | facebook | instagram | openphone | mailgun |
 * sms | whatsapp | chat | email | shopify | imap.
 */
export const ChannelProviderType = IntegrationProviderType
export type ChannelProviderType =
  (typeof IntegrationProviderType)[keyof typeof IntegrationProviderType]

/**
 * Message Type Categories
 * Used to categorize the form of a message — see `plans/threads/message-type-overhaul.md`.
 */
export enum MessageType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  CHAT = 'CHAT',
  CALL = 'CALL',
  VOICEMAIL = 'VOICEMAIL',
}

/**
 * Every {@link MessageType} member, in catalog order, with its author-facing
 * label — the option list for the `messageType` filter/view field
 * (`plans/threads/message-type-overhaul.md` §Phase 3).
 *
 * Mirrors `CHANNEL_GROUP_OPTIONS` (`channels/capabilities.ts:376`) in shape,
 * but `MessageType` is a fixed five-member vocabulary rather than something
 * derived from a per-provider capabilities map, so this is a literal list, not
 * a derivation. Declared here (not `resources/registry/enum-values.ts`, and
 * not deleted like that file's dead `MessageType` block) because this module
 * is client-safe — it only imports the generated `@auxx/database/enums` — and
 * `mail-view-field-definitions.ts`, which is used on both client and server,
 * already reaches into it via a plain relative import.
 */
export const MESSAGE_TYPE_OPTIONS: Array<{ value: MessageType; label: string }> = [
  { value: MessageType.EMAIL, label: 'Email' },
  { value: MessageType.SMS, label: 'SMS' },
  { value: MessageType.CHAT, label: 'Chat' },
  { value: MessageType.CALL, label: 'Call' },
  { value: MessageType.VOICEMAIL, label: 'Voicemail' },
]

/**
 * Active Messaging Providers
 * Providers that can actually send/receive messages
 */
export const MESSAGING_PROVIDERS = [
  ChannelProviderType.google,
  ChannelProviderType.outlook,
  ChannelProviderType.mailgun,
  ChannelProviderType.facebook,
  ChannelProviderType.instagram,
  ChannelProviderType.openphone,
  ChannelProviderType.whatsapp,
  ChannelProviderType.sms,
  ChannelProviderType.chat,
  ChannelProviderType.email,
  ChannelProviderType.imap,
] as const

/**
 * Data Providers
 * Providers that provide data but don't handle messaging
 */
export const DATA_PROVIDERS = [ChannelProviderType.shopify] as const

/**
 * All Provider Types
 * Complete list of all provider types
 */
export const ALL_PROVIDERS = [...MESSAGING_PROVIDERS, ...DATA_PROVIDERS] as const

/**
 * Type guard to check if a string is a valid provider type
 */
export function isValidProviderType(provider: string): provider is ChannelProviderType {
  return Object.values(ChannelProviderType).includes(provider as ChannelProviderType)
}

/**
 * Visual-ref icon per channel provider, rendered client-side by VisualIcon/AppIcon:
 * `brand:<slug>` resolves to `apps/web/public/icons/brands/<slug>.svg` (registered in
 * `BRAND_ICONS`); a bare kebab id is a lucide mark. Single source of truth for provider
 * marks — surfaced on `credentials.list` rows so the connection picker shows the
 * provider's brand instead of a generic key.
 */
export const PROVIDER_ICON_MAP: Record<ChannelProviderType, string> = {
  [ChannelProviderType.google]: 'brand:google',
  [ChannelProviderType.outlook]: 'brand:outlook',
  [ChannelProviderType.facebook]: 'brand:facebook',
  [ChannelProviderType.instagram]: 'brand:instagram',
  [ChannelProviderType.shopify]: 'brand:shopify',
  [ChannelProviderType.openphone]: 'phone',
  [ChannelProviderType.mailgun]: 'mail',
  [ChannelProviderType.sms]: 'message-square',
  [ChannelProviderType.whatsapp]: 'message-circle',
  [ChannelProviderType.chat]: 'message-square',
  [ChannelProviderType.email]: 'mail',
  [ChannelProviderType.imap]: 'mail',
}

/** Resolve a channel provider's icon visual-ref, or null for an unknown provider string. */
export function getChannelProviderIcon(provider: string): string | null {
  return isValidProviderType(provider) ? PROVIDER_ICON_MAP[provider] : null
}

/**
 * Type guard to check if a provider is a messaging provider
 */
export function isMessagingProvider(provider: ChannelProviderType): boolean {
  return MESSAGING_PROVIDERS.includes(provider as any)
}

/**
 * Type guard to check if a provider is a data provider
 */
export function isDataProvider(provider: ChannelProviderType): boolean {
  return DATA_PROVIDERS.includes(provider as any)
}

/**
 * Legacy type alias for backward compatibility
 * @deprecated Use ChannelProviderType enum instead
 */
export type ChannelProviderTypeString =
  | 'google'
  | 'outlook'
  | 'facebook'
  | 'instagram'
  | 'openphone'
  | 'mailgun'
  | 'sms'
  | 'whatsapp'
  | 'chat'
  | 'email'
  | 'shopify'
  | 'imap'

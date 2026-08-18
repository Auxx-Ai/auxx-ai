// packages/lib/src/channels/capabilities.ts

import { IdentifierType, IntegrationProviderType, MessageType } from '@auxx/database/enums'
import type {
  IdentifierType as IdentifierTypeValue,
  IntegrationProviderType as IntegrationProviderTypeValue,
  MessageType as MessageTypeValue,
} from '@auxx/database/types'

/**
 * The coarse channel a person would name in a rule — "when a new **SMS**
 * arrives", "when a **Facebook** message arrives".
 *
 * Deliberately NOT the provider (`openphone`, `google`) and NOT derived from
 * `channel` + `recipientModel`:
 *
 * - Providers are an implementation detail a filter should survive. `google`,
 *   `outlook`, `imap` and `mailgun` are all just "Email" to the author, and a
 *   second SMS provider beside `openphone` must not silently stop matching an
 *   existing `channelType is sms` rule.
 * - The derivation does not work: `facebook` and `instagram` are both
 *   `messaging` + `thread_only`, so the pair is indistinguishable, and
 *   `shopify` — a data-only integration that is not a channel at all — lands in
 *   the same bucket.
 *
 * So it is declared per provider, here, in the ONE map (the same reasoning as
 * `identifierType` below). `undefined` means "not a conversation channel" and
 * keeps the provider out of every channel-type option list.
 */
export type ChannelGroup = 'email' | 'sms' | 'whatsapp' | 'facebook' | 'instagram' | 'chat'

/**
 * Coarse, kopilot-facing capability map for an integration platform. This is
 * deliberately separate from `provider-capabilities.ts` (which is the detailed
 * runtime capability matrix) — the LLM only needs to know which channel each
 * integration is, what shape its recipients take, and which write affordances
 * the catalog should advertise.
 */
export interface PlatformCapabilities {
  channel: 'email' | 'messaging'
  /** Coarse, author-facing channel bucket. See {@link ChannelGroup}. */
  channelGroup?: ChannelGroup
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
   * Whether a formatted body is meaningful. `false` puts the composer's editor
   * in its `plain` variant and sends `textHtml: null` — the thread view then
   * renders `textPlain`. Mirrors `supportsRichText` in
   * `providers/provider-capabilities.ts`; THIS field is the UI authority.
   */
  richText: boolean
  /** Whether an email signature can be appended (and the `@` menu offered). */
  signature: boolean
  /**
   * Hard character cap the platform enforces on one outbound body. Undefined
   * means no cap worth surfacing. The composer shows a counter and blocks send
   * past it.
   */
  maxMessageLength?: number
  /**
   * Shape of identifier the platform sends to. `thread_only` means a brand-new
   * outbound is not possible (replies only — Facebook/Instagram DMs require an
   * inbound message first to open the customer-service window).
   */
  recipientModel: 'email' | 'phone' | 'platform_user' | 'thread_only'
  /**
   * The `IdentifierType` this platform's `Participant` rows are keyed by.
   *
   * NOT derivable from `recipientModel`: facebook and instagram are both
   * `thread_only` yet key on different id spaces (`FACEBOOK_PSID` /
   * `INSTAGRAM_IGSID`), and `platform_user` says nothing about `CHAT_VISITOR`.
   * So it is its own per-provider value — declared here, in the ONE map, rather
   * than in a switch beside every consumer.
   *
   * `undefined` for non-messaging integrations (`shopify`), which never produce
   * participants at all. Callers must handle that rather than defaulting.
   */
  identifierType?: IdentifierTypeValue
  /**
   * The `MessageType` the composer stamps on an OUTBOUND row for this channel.
   *
   * `Message.messageType` IS a stored, `NOT NULL` column (message-type-overhaul
   * plan §2.7/§3) — it can no longer be a pure function of `Integration.provider`,
   * because a call and a text can arrive on the SAME integration. This field is
   * NOT "the type every message on this channel reads back as" (a Quo thread can
   * hold rows of more than one `MessageType`); it is the default
   * `getMessageTypeFromProvider` (`providers/type-utils.ts`) returns for this
   * provider, which is what `ingest/store-message.ts` falls back to and what the
   * composer only ever creates (SMS/EMAIL/CHAT). `__tests__/capabilities.message-type.test.ts`
   * asserts the two maps agree for every provider.
   *
   * It is restated here because `getMessageTypeFromProvider` lives in
   * `providers/`, which has no client-safe subpath — the composer needs this
   * answer to stamp an optimistic row with the same value the server-stamped row
   * will carry, and stamping the wrong one flips a just-sent SMS through the
   * email renderer until the echo lands.
   */
  messageType: MessageTypeValue
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
  | 'channel'
  | 'newOutbound'
  | 'threadReply'
  | 'subject'
  | 'ccBcc'
  | 'attachments'
  | 'recipientModel'
  | 'richText'
  | 'signature'
  | 'maxMessageLength'
  | 'messageType'
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
    channelGroup: 'email',
    messageType: MessageType.EMAIL,
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    richText: true,
    signature: true,
    recipientModel: 'email',
    identifierType: IdentifierType.EMAIL,
  },
  [IntegrationProviderType.outlook]: {
    channel: 'email',
    channelGroup: 'email',
    messageType: MessageType.EMAIL,
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    richText: true,
    signature: true,
    recipientModel: 'email',
    identifierType: IdentifierType.EMAIL,
  },
  [IntegrationProviderType.email]: {
    channel: 'email',
    channelGroup: 'email',
    messageType: MessageType.EMAIL,
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    richText: true,
    signature: true,
    recipientModel: 'email',
    identifierType: IdentifierType.EMAIL,
  },
  [IntegrationProviderType.imap]: {
    channel: 'email',
    channelGroup: 'email',
    messageType: MessageType.EMAIL,
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    richText: true,
    signature: true,
    recipientModel: 'email',
    identifierType: IdentifierType.EMAIL,
  },
  [IntegrationProviderType.mailgun]: {
    channel: 'email',
    channelGroup: 'email',
    messageType: MessageType.EMAIL,
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
    richText: true,
    signature: true,
    recipientModel: 'email',
    identifierType: IdentifierType.EMAIL,
  },
  [IntegrationProviderType.facebook]: {
    channel: 'messaging',
    channelGroup: 'facebook',
    messageType: MessageType.CHAT,
    newOutbound: false,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    richText: false,
    signature: false,
    recipientModel: 'thread_only',
    identifierType: IdentifierType.FACEBOOK_PSID,
    notes: '24h customer-service window for freeform replies',
  },
  [IntegrationProviderType.instagram]: {
    channel: 'messaging',
    channelGroup: 'instagram',
    messageType: MessageType.CHAT,
    newOutbound: false,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    richText: false,
    signature: false,
    recipientModel: 'thread_only',
    identifierType: IdentifierType.INSTAGRAM_IGSID,
  },
  [IntegrationProviderType.sms]: {
    channel: 'messaging',
    channelGroup: 'sms',
    messageType: MessageType.SMS,
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: false,
    richText: false,
    signature: false,
    // No `maxMessageLength`: this is the generic SMS placeholder, not a wired
    // provider, so there is no verified API cap to enforce. `openphone` below
    // is the real one.
    recipientModel: 'phone',
    identifierType: IdentifierType.PHONE,
  },
  [IntegrationProviderType.openphone]: {
    channel: 'messaging',
    channelGroup: 'sms',
    // Quo also ingests call records, but a composer send is always a text —
    // and the read path derives one type per provider, so SMS is the answer
    // for every message on this channel.
    messageType: MessageType.SMS,
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
    richText: false,
    signature: false,
    // Quo's `POST /v1/messages` rejects `content` over 1600 characters. This is
    // the API cap, NOT the 160-character GSM segment size — the composer shows
    // segment count separately because segments are the billing unit.
    maxMessageLength: 1600,
    recipientModel: 'phone',
    identifierType: IdentifierType.PHONE,
  },
  [IntegrationProviderType.whatsapp]: {
    channel: 'messaging',
    channelGroup: 'whatsapp',
    messageType: MessageType.CHAT,
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    richText: false,
    signature: false,
    recipientModel: 'phone',
    identifierType: IdentifierType.PHONE,
    notes: 'cold sends require approved template',
  },
  [IntegrationProviderType.chat]: {
    channel: 'messaging',
    channelGroup: 'chat',
    messageType: MessageType.CHAT,
    newOutbound: true,
    threadReply: true,
    subject: false,
    ccBcc: false,
    drafts: true,
    attachments: true,
    richText: false,
    signature: false,
    recipientModel: 'platform_user',
    identifierType: IdentifierType.CHAT_VISITOR,
  },
  [IntegrationProviderType.shopify]: {
    // Data-only integration — not a messaging channel. Excluded from the
    // catalog by callers via `channel` filter or `newOutbound + threadReply`.
    channel: 'messaging',
    // Never produces messages. EMAIL only to agree with the server-side
    // `getMessageTypeFromProvider`, whose fallback is EMAIL.
    messageType: MessageType.EMAIL,
    newOutbound: false,
    threadReply: false,
    subject: false,
    ccBcc: false,
    drafts: false,
    attachments: false,
    richText: false,
    signature: false,
    recipientModel: 'thread_only',
    notes: 'data-only integration, not a messaging channel',
  },
}

/** Author-facing label for each {@link ChannelGroup}. */
export const CHANNEL_GROUP_LABELS: Record<ChannelGroup, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  chat: 'Live chat',
}

/**
 * Every channel group, in catalog order, with its label — the option list for
 * the `channelType` filter/view/search field.
 *
 * DERIVED from `PLATFORM_CAPABILITIES` rather than hand-written, so a new
 * provider becomes filterable by declaring `channelGroup` and nothing else.
 * Providers with no `channelGroup` (`shopify` — a data-only integration) never
 * appear.
 */
export const CHANNEL_GROUP_OPTIONS: ReadonlyArray<{ value: ChannelGroup; label: string }> =
  Object.keys(CHANNEL_GROUP_LABELS)
    .filter((group) =>
      Object.values(PLATFORM_CAPABILITIES).some((caps) => caps.channelGroup === group)
    )
    .map((group) => ({
      value: group as ChannelGroup,
      label: CHANNEL_GROUP_LABELS[group as ChannelGroup],
    }))

/**
 * Every provider belonging to a channel group — the `Integration.provider`
 * values a `channelType` condition compiles to.
 *
 * Unknown group names return an empty list, which callers must treat as
 * "matches nothing" rather than "matches everything".
 */
export function providersForChannelGroup(group: string): IntegrationProviderTypeValue[] {
  return (Object.keys(PLATFORM_CAPABILITIES) as IntegrationProviderTypeValue[]).filter(
    (provider) => PLATFORM_CAPABILITIES[provider].channelGroup === group
  )
}

/** The coarse channel group a provider belongs to; `undefined` when it is not a channel. */
export function channelGroupForProvider(
  provider: string | null | undefined
): ChannelGroup | undefined {
  if (!provider) return undefined
  return PLATFORM_CAPABILITIES[provider as IntegrationProviderTypeValue]?.channelGroup
}

/** Plucks the composer-facing subset for one provider. `undefined` for an unknown provider. */
export function getComposerCapabilities(provider: string): ComposerCapabilities | undefined {
  return PLATFORM_CAPABILITIES[provider as IntegrationProviderTypeValue]
}

/**
 * The `IdentifierType` a channel of this provider keys its participants by.
 *
 * THE single provider→identifier-type mapping. Before this existed,
 * `ingest/participants/normalize.ts` carried its own switch — a third
 * hand-maintained per-provider list beside the two capability maps, and the
 * same drift that left `openphone` out of the composer's From picker for
 * months. Anything needing this answer reads it here.
 *
 * `undefined` for an unknown provider and for `shopify` (a data-only
 * integration with no participants). Callers decide what to do with that —
 * ingest falls back to a shape guess, the send path refuses.
 */
export function identifierTypeForProvider(
  provider: string | null | undefined
): IdentifierTypeValue | undefined {
  if (!provider) return undefined
  return PLATFORM_CAPABILITIES[provider as IntegrationProviderTypeValue]?.identifierType
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

// packages/lib/src/providers/openphone/types.ts
// Wire shapes for Quo (formerly OpenPhone), https://api.quo.com/v1.
//
// The provider key stays `openphone` everywhere it is persisted (IntegrationProviderType,
// Credential.type, Integration.provider, /api/openphone/webhook) — this is a labels-only
// rename. New *types* use the `Quo` prefix.
//
// ⚠️ REST and webhook return DIFFERENT shapes for the same logical message. Verified live:
//
//   |            | webhook (`data.object`) | REST (`GET /v1/messages`) |
//   | body text  | `body`                  | `text`                    |
//   | recipient  | `to` (string)           | `to` (string[])           |
//   | media      | `media: [{url,type}]`   | absent — never returned   |
//
// They are therefore two types with two mappers. A single shared type would silently read
// `undefined` on one of the two paths and produce empty messages rather than a crash.

/**
 * Describes the expected structure in the Integration.metadata field. The apiKey is NOT here —
 * it lives encrypted on the Credential (resolved via Integration.credentialId). Only non-secret
 * routing identity sits in metadata.
 *
 * `webhookSigningSecret` is the per-channel key Quo mints when we create the webhook
 * (`POST /v1/webhooks/messages` → `data.key`); it is written to the Credential secret bag by the
 * provisioning hook, never here.
 */
export interface OpenPhoneIntegrationMetadata {
  phoneNumberId: string
  phoneNumber: string // E.164 format
  webhookId?: string // ID of the webhook created via API (WH…)
}

// ---------------------------------------------------------------------------
// REST resources
// ---------------------------------------------------------------------------

/** A workspace member attached to a phone number. */
export interface QuoUser {
  id: string // US…
  email: string
  firstName: string | null
  lastName: string | null
  role: string
  groupId?: string | null
}

/**
 * Per-region messaging/calling restrictions. Only a number whose
 * `messaging.US === 'unrestricted'` can send US SMS — the others fail at send time with no
 * signal in our UI, which is why we cache this alongside the number.
 */
export interface QuoRestrictions {
  calling?: Record<string, string>
  messaging?: Record<string, string>
}

/** `GET /v1/phone-numbers` → `data[]`. */
export interface QuoPhoneNumber {
  id: string // PN…
  number: string // E.164
  name: string | null
  formattedNumber?: string | null
  symbol?: string | null
  groupId?: string | null
  forward?: string | null
  portingStatus?: string | null
  restrictions?: QuoRestrictions
  users?: QuoUser[]
  createdAt?: string
  updatedAt?: string
}

/**
 * The trimmed projection cached on `Credential.metadata.quo.phoneNumbers`. Deliberately drops
 * `users[]` (member emails/names we do not need, and the part that goes stale fastest) while
 * keeping `restrictions`, which is the difference between a channel that works and one that
 * silently cannot send.
 */
export interface QuoCachedPhoneNumber {
  id: string
  number: string
  name: string | null
  restrictions?: QuoRestrictions
}

/** The `Credential.metadata.quo` bag. Derived provider state — NOT `connectionVariables`. */
export interface QuoCredentialMetadata {
  phoneNumbers: QuoCachedPhoneNumber[]
  fetchedAt: string
}

/** Media on a webhook message/call payload. REST never returns this. */
export interface QuoMedia {
  url: string
  type: string
  duration?: number
}

/**
 * A message as it arrives on a **webhook** (`data.object`).
 *
 * Verified against a live `apiVersion: "v4"` payload on 2026-08-15 — read off a stored
 * `Message.metadata.quo_webhook_event`, not from the docs. Two corrections to what this file
 * previously declared, both of which failed silently as `undefined` reads:
 *
 * - the body text is **`text`**, not `body` (the docs' `body` does not appear on the wire)
 * - there is **no `conversationId`** on the message object at all. The only carrier of the
 *   conversation key is `data.deepLink` on the envelope — see {@link QuoWebhookEventData}.
 *
 * `to` is still a plain string here (REST returns an array), which is why the webhook and REST
 * shapes stay separate types with separate mappers.
 */
export interface QuoWebhookMessage {
  id: string // AC…
  object: 'message'
  from: string
  to: string
  direction: 'incoming' | 'outgoing'
  /** Body text. NOT `body` — see the note above. */
  text: string
  media?: QuoMedia[]
  status: string
  createdAt: string
  updatedAt?: string
  userId?: string
  contactIds?: string[]
  phoneNumberId: string
}

/**
 * A message as returned by **REST** (`GET /v1/messages`, `GET /v1/messages/{id}`,
 * `POST /v1/messages`). Note `text` (not `body`) and `to` as an array. Media is never present.
 */
export interface QuoRestMessage {
  id: string // AC…
  to: string[]
  from: string
  text: string
  direction: 'incoming' | 'outgoing'
  status: string
  createdAt: string
  updatedAt?: string
  userId?: string
  phoneNumberId: string
  conversationId: string // CN…
}

/**
 * A call as it arrives on a webhook. The message shape plus voicemail/recording media.
 * REST calls carry a different set (`answeredBy`, `callRoute`, `duration`, …) and omit media.
 */
export interface QuoWebhookCall {
  id: string
  object: 'call'
  from: string
  to: string
  direction: 'incoming' | 'outgoing'
  status: string
  media?: QuoMedia[]
  voicemail?: QuoMedia | null
  answeredAt?: string | null
  completedAt?: string | null
  createdAt: string
  userId?: string
  phoneNumberId: string
  // No `conversationId` — same envelope as QuoWebhookMessage, same omission. Unverified for
  // calls specifically (we subscribe to none), but assume the message shape until proven otherwise
  // rather than re-declaring a field the docs promise and the wire has never delivered.
}

/**
 * `GET /v1/conversations` → `data[]`. There is **no** `latestMessage` field, and
 * `GET /v1/conversations/{id}` does not exist — only the list endpoint.
 */
export interface QuoConversation {
  id: string // CN…
  phoneNumberId: string
  participants: string[]
  name: string | null
  assignedTo: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastActivityId?: string | null
  deletedAt?: string | null
  mutedUntil?: string | null
  snoozedUntil?: string | null
}

/** `POST /v1/webhooks/messages` → `data`. The signing `key` comes back on create. */
export interface QuoWebhook {
  id: string // WH…
  key: string // base64 of 32 raw bytes — the HMAC signing key
  url: string
  label?: string | null
  status: 'enabled' | 'disabled'
  events: string[]
  resourceIds: string[]
  createdAt?: string
  updatedAt?: string
}

// ---------------------------------------------------------------------------
// Webhook envelope
// ---------------------------------------------------------------------------

/**
 * Every Quo webhook shares one envelope; only `data.object` varies.
 *
 * Events carrying `phoneNumberId` (resolvable to an Integration): `message.received`,
 * `message.delivered`, `call.ringing`, `call.completed`, `call.recording.completed`.
 * Events that do NOT: `call.summary.completed`, `call.transcript.completed`,
 * `contact.updated`, `contact.deleted` — do not subscribe to these without building a
 * `callId` → prior-call or credential-scoped lookup first.
 */
export interface QuoWebhookEvent<T = unknown> {
  id: string // EV…
  object: 'event'
  apiVersion: string
  createdAt: string
  type: string
  data: QuoWebhookEventData<T>
}

/**
 * The envelope's `data` bag.
 *
 * `deepLink` is the **only** place a message webhook names its conversation — the message object
 * carries no `conversationId` (verified live, v4). Shaped
 * `https://my.quo.com/inbox/<PN…>/c/<CN…>?at=<AC…>`, which
 * {@link parseConversationIdFromDeepLink} extracts the `CN…` from.
 */
export interface QuoWebhookEventData<T = unknown> {
  object: T
  deepLink?: string
}

/** Convenience alias for the two message events we subscribe to. */
export type QuoMessageWebhookEvent = QuoWebhookEvent<QuoWebhookMessage>

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/**
 * `POST /v1/messages`. `from` is the E.164 number or `PN…` id (`phoneNumberId` is deprecated).
 * `to` accepts 1–10 recipients. There is no `media`/`attachments` field — outbound MMS is not
 * supported by Quo.
 */
export interface QuoSendMessageInput {
  content: string
  from: string
  to: string[]
  userId?: string
  setInboxStatus?: 'done'
}

/** `POST /v1/webhooks/messages`. */
export interface QuoCreateMessageWebhookInput {
  url: string
  events: Array<'message.received' | 'message.delivered'>
  resourceIds: string[]
  label?: string
  status?: 'enabled' | 'disabled'
  userId?: string
}
